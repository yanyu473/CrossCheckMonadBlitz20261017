import express, { type NextFunction, type Request, type Response } from 'express';
import { resolve } from 'node:path';
import QRCode from 'qrcode';
import { AppError } from './chain.js';
import { modelsConfigured } from './adapters.js';
import { ROOT } from './config.js';
import type { JobService } from './service.js';
import type { StoredEvent } from './store.js';

export interface AppOptions { static_root?: string }

export function createApp(service: JobService, options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json({ limit: Math.max(2048, service.config.max_input_chars * 12 + 512), strict: true }));
  // Serve only reviewed browser assets. Do not expose the repository as a static directory.
  const staticRoot = options.static_root ?? ROOT;
  const publicFiles = new Map([
    ['/', 'index.html'], ['/index.html', 'index.html'], ['/submit.html', 'submit.html'],
    ['/screen.html', 'screen.html'], ['/cert.html', 'cert.html'],
    ['/browser-shared.js', 'browser-shared.js'], ['/index-page.js', 'index-page.js'],
    ['/submit-page.js', 'submit-page.js'], ['/screen-page.js', 'screen-page.js'],
    ['/cert-page.js', 'cert-page.js'], ['/front-overrides.css', 'front-overrides.css'],
    ['/vendor/protocol.js', 'vendor/protocol.js'],
    ['/vendor/ethers.js', 'node_modules/ethers/dist/ethers.umd.min.js'],
  ]);
  for (const [route, filename] of publicFiles) app.get(route, (_req, res, next) => {
    res.sendFile(resolve(staticRoot, filename), { dotfiles: 'deny' }, (error) => {
      if (error) next((error as { status?: number }).status === 404 ? new AppError('NOT_FOUND', 404) : error);
    });
  });
  app.get('/favicon.ico', (_req, res) => { res.status(204).end(); });
  const rates = new Map<string, { start: number; count: number }>();
  app.post('/api/verify', async (req, res) => {
    // Never trust arbitrary X-Forwarded-For sent by the client.
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    for (const [key, entry] of rates) if (now - entry.start >= 60000) rates.delete(key);
    const rate = rates.get(ip) ?? { start: now, count: 0 };
    if (rate.count >= service.config.rate_limit || rates.size >= 10000 && !rates.has(ip)) {
      res.setHeader('Retry-After', '60');
      throw new AppError('RATE_LIMITED', 429);
    }
    rate.count++; rates.set(ip, rate);
    if (!req.body || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'content')) {
      throw new AppError('INVALID_REQUEST', 400);
    }
    res.status(202).json(await service.submit(req.body.content));
  });
  app.get('/api/jobs/latest', (_req, res) => {
    const latest = [...service.jobs.values()].reverse().sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];
    res.json(latest ? service.view(latest.job_id) : null);
  });
  app.get('/api/jobs/:job_id', (req, res) => res.json(service.view(req.params.job_id)));
  const streams = new Set<Response>();
  app.get('/api/stream/:job_id', (req, res) => {
    const job = service.get(req.params.job_id);
    if (streams.size >= 100) throw new AppError('TOO_MANY_STREAMS', 429);
    const last = req.get('Last-Event-ID') ?? '0';
    if (!/^\d+$/.test(last) || !Number.isSafeInteger(Number(last)) || Number(last) > (job.events.at(-1)?.id ?? 0)) {
      throw new AppError('INVALID_EVENT_ID', 400);
    }
    let cursor = Number(last);
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders(); streams.add(res);
    const send = (event: StoredEvent) => {
      if (event.id <= cursor || res.destroyed || res.writableEnded) return;
      cursor = event.id;
      if (res.writableLength > 1024 * 1024) { res.destroy(); return; }
      res.write(`id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
      if (event.event === 'done') res.end();
    };
    const cleanup = () => {
      clearInterval(heartbeat); service.events.off(job.job_id, send); streams.delete(res);
    };
    const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': heartbeat\n\n'); }, 15000);
    heartbeat.unref(); res.on('close', cleanup);
    // Subscribe before replay; synchronous replay and monotonic cursor remove races/duplicates.
    service.events.on(job.job_id, send);
    // A recovered confirmation may follow a previous done: replay all history before closing.
    const replay = job.events.filter((event) => event.id > cursor);
    for (let i = 0; i < replay.length; i++) {
      const event = replay[i];
      if (event.event === 'done' && i < replay.length - 1) {
        cursor = event.id;
        res.write(`id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
      } else send(event);
    }
    if (job.finished && !res.writableEnded) res.end();
  });
  const download = (res: Response, filename: string, report: unknown) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(report, null, 2));
  };
  app.get('/api/jobs/:job_id/report', (req, res) => {
    const report = service.report(req.params.job_id);
    download(res, `crosscheck-${report.payload.job_id}.json`, report);
  });
  app.get('/api/cert/:id', async (req, res) => res.json(await service.certificate(req.params.id)));
  app.get('/api/cert/:id/report', async (req, res) => {
    const { report } = await service.certificate(req.params.id);
    download(res, `crosscheck-${report.payload.job_id}.json`, report);
  });
  app.get('/api/config', (_req, res) => res.json({ ...service.config.public,
    backend_mode: 'a-integrated', live_available: modelsConfigured(service.config.models), chain_ready: service.chain.configured,
  }));
  app.get('/api/qr', async (req, res) => {
    const text = req.query.text;
    if (typeof text !== 'string' || text.length > 2000) throw new AppError('INVALID_QR_URL', 400);
    try {
      const target = new URL(text);
      const allowed = new Set([`${req.protocol}://${req.get('host')}`]);
      if (service.config.public.public_origin) allowed.add(new URL(service.config.public.public_origin).origin);
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || !allowed.has(target.origin) ||
        !['/', '/index.html', '/submit.html', '/screen.html', '/cert.html'].includes(target.pathname)) throw new Error('Invalid');
    } catch { throw new AppError('INVALID_QR_URL', 400); }
    res.type('image/png').send(await QRCode.toBuffer(text, { width: 320, margin: 2, errorCorrectionLevel: 'M' }));
  });
  app.get('/api/health', (_req, res) => {
    const health = service.health(); res.status(health.status === 'ok' ? 200 : 503).json(health);
  });
  app.use((_req, _res, next) => next(new AppError('NOT_FOUND', 404)));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) { res.end(); return; }
    const bodyError = error as { type?: string };
    const status = error instanceof AppError ? error.http_status :
      bodyError.type === 'entity.too.large' ? 413 : bodyError.type === 'entity.parse.failed' ? 400 : 500;
    const code = error instanceof AppError ? error.code : status === 413 ? 'BODY_TOO_LARGE' :
      status === 400 ? 'INVALID_JSON' : 'INTERNAL_ERROR';
    res.status(status).json({ error: { code, message: code } });
  });
  return { app, closeStreams: () => { for (const stream of streams) stream.end(); } };
}
