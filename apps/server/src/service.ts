import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { assertValidUnicode, canonicalizeJson, deriveAgreement, hashContent, hashPayload,
  modelResultSchema, validateReportEnvelope, type AnchorInput, type CertificateRecord, type ChainProof,
  type JobStatus, type JobView, type ModelResult, type ReportPayload } from '@crosscheck/protocol';
import { createModelAdapters, modelsConfigured, RULE_PROMPT, type ModelAdapter } from './adapters.js';
import { AppError, safeChainCode, type ChainGateway } from './chain.js';
import type { ServerConfig } from './config.js';
import { JobStore, type StoredEvent, type StoredJob } from './store.js';

export const RULE_VERSION = 'crosscheck-v1-2026-10-17';
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const clone = <T>(value: T): T => structuredClone(value);
async function deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AppError('CONFIRMATION_TIMEOUT', 503)), milliseconds);
    })]);
  } finally { clearTimeout(timer!); }
}

export class JobService {
  readonly jobs = new Map<string, StoredJob>();
  readonly events = new EventEmitter();
  readonly prompt_hash = hashContent(RULE_PROMPT);
  readonly model_config_hash: string;
  readonly adapters: [ModelAdapter, ModelAdapter];
  private queue: string[] = [];
  private tasks = new Set<Promise<void>>();
  private admission: Promise<unknown> = Promise.resolve();
  private chainTail: Promise<unknown> = Promise.resolve();
  private writerInFlight?: Promise<ChainProof>;
  private recoveryTimer?: ReturnType<typeof setInterval>;
  private recovering = false;
  private recoveryTask?: Promise<void>;
  private closing = false;
  private storeClosed = false;
  private chainClosed = false;
  private storageFailed = false;
  constructor(readonly config: ServerConfig, readonly store: JobStore, readonly chain: ChainGateway,
    adapters?: [ModelAdapter, ModelAdapter]) {
    this.adapters = adapters ?? createModelAdapters(config.models);
    this.model_config_hash = hashContent(canonicalizeJson({ mode: config.mode, adapter_version: '1',
      max_output_tokens: 2048, timeout_ms: config.models.timeout_ms,
      models: this.adapters.map(({ slot, provider, requested_model }) => ({ slot, provider, requested_model })) }));
    this.events.setMaxListeners(200);
  }
  async init() {
    try {
    for (const job of await this.store.init()) {
      if (job.payload) {
        validateReportEnvelope({ payload: job.payload, proof: job.proof });
        if (job.hashes?.content_hash !== hashContent(job.payload.raw_text) ||
            job.hashes.verdict_hash !== hashPayload(job.payload)) throw new Error('CORRUPT_JOB_STORE');
      }
      this.jobs.set(job.job_id, job);
      if (!job.finished) {
        if (job.status === 'confirmed' && job.proof) {
          await this.finish(job);
        } else if (job.mode === 'demo' && job.status === 'report_ready' && job.payload) {
          await this.finish(job);
        } else if (job.anchor.attempted_at) {
          job.error = { code: job.anchor.tx_hash ? 'CONFIRMATION_PENDING' : 'BROADCAST_OUTCOME_UNKNOWN',
            message: '服务中断；保留报告与广播记录，仅恢复查询，不自动重发。' };
          await this.status(job, 'anchor_failed');
          await this.finish(job);
        } else {
          job.error = { code: 'PROCESS_INTERRUPTED', message: '任务因服务重启中断，请重新提交。' };
          await this.status(job, 'interrupted');
          await this.finish(job);
        }
      }
    }
    await this.recoverBroadcasts();
    this.recoveryTimer = setInterval(() => { void this.recoverBroadcasts().catch(() => { this.storageFailed = true; }); },
      this.config.recovery_interval_ms);
    this.recoveryTimer.unref();
    } catch (error) { await this.store.close(); throw error; }
  }
  private async persist(job: StoredJob) {
    try { await this.store.save(job); } catch (e) { this.storageFailed = true; throw e; }
  }
  private async emit(job: StoredJob, event: string, data: Record<string, unknown>) {
    const item: StoredEvent = { id: (job.events.at(-1)?.id ?? 0) + 1, event, data: { ...clone(data), job_id: job.job_id } };
    job.events.push(item);
    await this.persist(job);
    this.events.emit(job.job_id, clone(item));
  }
  private async status(job: StoredJob, status: JobStatus) {
    job.status = status;
    await this.emit(job, 'job_status', { status });
  }
  private async finish(job: StoredJob) {
    job.finished = true;
    await this.emit(job, 'done', { status: job.status });
  }
  get(job_id: string): StoredJob {
    const job = this.jobs.get(job_id);
    if (!job) throw new AppError('JOB_NOT_FOUND', 404);
    return job;
  }
  view(job_id: string): JobView & { anchor: StoredJob['anchor'] } {
    const { job_id: id, mode, status, results, payload, hashes, proof, error, anchor } = this.get(job_id);
    return clone({ job_id: id, mode, status, results, payload, hashes, proof, error, anchor });
  }
  report(job_id: string) {
    const job = this.get(job_id);
    if (!job.payload) throw new AppError('REPORT_NOT_READY', 409);
    return clone({ payload: job.payload, proof: job.proof });
  }
  async submit(content: unknown): Promise<{ job_id: string; status: JobStatus; stream_url: string; reused: boolean }> {
    if (typeof content !== 'string' || !content.trim()) throw new AppError('INVALID_CONTENT', 400);
    if (content.length > this.config.max_input_chars) throw new AppError('CONTENT_TOO_LONG', 413);
    try { assertValidUnicode(content); } catch { throw new AppError('INVALID_UNICODE', 400); }
    const task = this.admission.then(async () => {
      if (this.closing || this.storageFailed) throw new AppError('SERVICE_UNAVAILABLE', 503);
      const key = hashContent(canonicalizeJson({ content_hash: hashContent(content), rule_version: RULE_VERSION,
        prompt_hash: this.prompt_hash, model_config_hash: this.model_config_hash }));
      const prior = [...this.jobs.values()].reverse().find((job) => job.cache_key === key &&
        (!job.finished || (job.anchor.attempted_at && job.status === 'anchor_failed' &&
          job.error?.code !== 'TRANSACTION_REVERTED') || (job.payload && job.payload.agreement !== 2 &&
          (job.status === 'confirmed' || (job.mode === 'demo' && job.status === 'report_ready')) &&
          Date.now() - Date.parse(job.payload.completed_at) < this.config.cache_ttl_ms)));
      if (prior) return { job_id: prior.job_id, status: prior.status, stream_url: `/api/stream/${prior.job_id}`, reused: true };
      if (this.queue.length + this.tasks.size >= this.config.max_queue + this.config.max_concurrent) {
        throw new AppError('QUEUE_FULL', 429);
      }
      const job: StoredJob = { job_id: randomUUID(), mode: this.config.mode, status: 'queued',
        results: [], payload: null, hashes: null, proof: null, error: null, raw_text: content,
        submitted_at: new Date().toISOString(), cache_key: key, events: [], finished: false,
        anchor: { attempted_at: null, tx_hash: null } };
      this.jobs.set(job.job_id, job);
      await this.emit(job, 'job_status', { status: 'queued' });
      this.queue.push(job.job_id);
      // Admission response is formed before model work begins.
      setImmediate(() => this.pump());
      return { job_id: job.job_id, status: 'queued' as const, stream_url: `/api/stream/${job.job_id}`, reused: false };
    });
    this.admission = task.catch(() => {});
    return task;
  }
  private pump() {
    while (!this.closing && !this.storageFailed && this.queue.length && this.tasks.size < this.config.max_concurrent) {
      const job = this.get(this.queue.shift()!);
      const task = this.run(job).catch(async () => {
        job.error = { code: 'PROCESSING_ERROR', message: '任务处理失败；已生成报告仍可下载。' };
        try { await this.status(job, job.payload ? 'anchor_failed' : 'failed'); await this.finish(job); }
        catch { this.storageFailed = true; }
      }).finally(() => { this.tasks.delete(task); this.pump(); });
      this.tasks.add(task);
    }
  }
  private async run(job: StoredJob) {
    await this.status(job, 'running');
    const results = await Promise.allSettled(this.adapters.map(async (adapter) => {
      let result: ModelResult;
      try {
        result = modelResultSchema.parse(await adapter.run(job.raw_text));
        if (result.slot !== adapter.slot) throw new Error('INVALID_SLOT');
      } catch {
        result = { slot: adapter.slot, provider: adapter.provider, requested_model: adapter.requested_model,
          returned_model: null, status: 'failed', verdict: null, reason: null, error_code: 'INVALID_OUTPUT' };
      }
      job.results.push(result);
      job.results.sort((a, b) => a.slot.localeCompare(b.slot));
      await this.emit(job, result.status === 'succeeded' ? 'model_result' : 'model_error',
        { slot: result.slot, result, ...(result.status === 'failed' ? { error: { code: result.error_code, message: '模型未返回有效判断。' } } : {}) });
      return result;
    }));
    if (results.some((r) => r.status === 'rejected')) throw new Error('MODEL_EVENT_PERSIST_FAILED');
    const models = results.map((r) => (r as PromiseFulfilledResult<ModelResult>).value) as [ModelResult, ModelResult];
    const agreement = deriveAgreement(models);
    if (agreement === null) {
      job.error = { code: 'BOTH_MODELS_FAILED', message: '两个模型均失败，未生成有效报告或凭证。' };
      await this.status(job, 'failed'); await this.finish(job); return;
    }
    const payload: ReportPayload = { schema_version: '1', job_id: job.job_id, mode: job.mode, raw_text: job.raw_text,
      submitted_at: job.submitted_at, completed_at: new Date().toISOString(), rule_version: RULE_VERSION,
      prompt_hash: this.prompt_hash, model_config_hash: this.model_config_hash, models, agreement };
    validateReportEnvelope({ payload, proof: null });
    // A separately serialized snapshot is never mutated by proof or status updates.
    job.payload = clone(payload);
    job.hashes = { content_hash: hashContent(job.raw_text), verdict_hash: hashPayload(payload) };
    await this.status(job, 'report_ready');
    await this.emit(job, 'report_ready', { payload: job.payload, hashes: job.hashes });
    if (job.mode === 'demo') { await this.finish(job); return; }
    if (!this.chain.configured) {
      job.error = { code: 'NOT_CONFIGURED', message: '报告已生成；真实链模块或部署配置尚未就绪，未上链。' };
      await this.status(job, 'anchor_failed');
      await this.emit(job, 'anchor_error', { error: job.error });
      await this.finish(job); return;
    }
    // One sponsored issuer: serialize writer calls to avoid nonce races.
    const anchorTask = this.chainTail.then(() => this.anchor(job));
    this.chainTail = anchorTask.catch(() => {});
    await anchorTask;
  }
  private input(job: StoredJob): AnchorInput {
    return { job_id: job.job_id, ...job.hashes!, agreement: job.payload!.agreement };
  }
  private async anchor(job: StoredJob) {
    // A timed-out transport may still be alive. Do not overlap wallet calls with it.
    if (this.writerInFlight) {
      job.error = { code: 'CHAIN_WRITER_BUSY', message: '前一笔广播调用尚未结束；报告已保存，本任务未发送交易。' };
      await this.status(job, 'anchor_failed');
      await this.emit(job, 'anchor_error', { error: job.error });
      await this.finish(job); return;
    }
    job.anchor.attempted_at = new Date().toISOString();
    await this.status(job, 'anchoring');
    try {
      const rawAnchor = Promise.resolve().then(() => this.chain.anchor(this.input(job), async (tx_hash) => {
        if (this.storeClosed) throw new AppError('STORE_CLOSED');
        if (!TX_HASH.test(tx_hash)) throw new AppError('RECORD_MISMATCH');
        if (job.anchor.tx_hash && job.anchor.tx_hash.toLowerCase() !== tx_hash.toLowerCase()) throw new AppError('RECORD_MISMATCH');
        job.anchor.tx_hash = tx_hash;
        await this.emit(job, 'anchor_submitted', { tx_hash });
      }));
      this.writerInFlight = rawAnchor;
      const clearWriter = () => { if (this.writerInFlight === rawAnchor) this.writerInFlight = undefined; };
      void rawAnchor.then(clearWriter, clearWriter);
      const proof = await deadline(rawAnchor, this.config.chain_timeout_ms);
      if (!job.anchor.tx_hash || proof.tx_hash.toLowerCase() !== job.anchor.tx_hash.toLowerCase()) throw new AppError('RECORD_MISMATCH');
      const record = await deadline(this.chain.read(proof.certificate_id, proof.tx_hash), this.config.chain_timeout_ms);
      this.checkRecord(job, record, proof.certificate_id);
      if (canonicalizeJson(record.proof) !== canonicalizeJson(proof)) throw new AppError('RECORD_MISMATCH');
      await this.confirm(job, record.proof);
    } catch (error) {
      const errorTx = (error as { tx_hash?: unknown })?.tx_hash;
      if (!job.anchor.tx_hash && typeof errorTx === 'string' && TX_HASH.test(errorTx)) {
        job.anchor.tx_hash = errorTx;
        await this.emit(job, 'anchor_submitted', { tx_hash: errorTx });
      }
      job.error = { code: safeChainCode(error), message: '报告已保存，上链未确认；保留交易记录，不自动重发。' };
      await this.status(job, 'anchor_failed');
      await this.emit(job, 'anchor_error', { error: job.error, ...(job.anchor.tx_hash ? { tx_hash: job.anchor.tx_hash } : {}) });
      await this.finish(job);
    }
  }
  private checkRecord(job: StoredJob, record: CertificateRecord, id?: string) {
    validateReportEnvelope({ payload: job.payload, proof: record.proof });
    const config = this.config.public;
    if (record.content_hash.toLowerCase() !== job.hashes!.content_hash.toLowerCase() ||
        record.verdict_hash.toLowerCase() !== job.hashes!.verdict_hash.toLowerCase() ||
        record.agreement !== job.payload!.agreement || record.proof.chain_id !== config.chain_id ||
        !config.contract_address || record.proof.contract_address.toLowerCase() !== config.contract_address.toLowerCase() ||
        !config.issuer || record.proof.issuer.toLowerCase() !== config.issuer.toLowerCase() ||
        (id !== undefined && record.proof.certificate_id !== id) ||
        (job.anchor.tx_hash && record.proof.tx_hash.toLowerCase() !== job.anchor.tx_hash.toLowerCase())) {
      throw new AppError('RECORD_MISMATCH', 409);
    }
  }
  private async confirm(job: StoredJob, proof: ChainProof) {
    job.proof = clone(proof); job.error = null;
    await this.status(job, 'confirmed');
    await this.emit(job, 'anchor_confirmed', { proof });
    await this.finish(job);
  }
  recoverBroadcasts(): Promise<void> {
    if (this.recoveryTask) return this.recoveryTask;
    this.recoveryTask = this.runRecovery().finally(() => { this.recoveryTask = undefined; });
    return this.recoveryTask;
  }
  private async runRecovery() {
    if (this.recovering || this.closing || !this.chain.configured || !this.chain.recover) return;
    this.recovering = true;
    try {
      for (const job of this.jobs.values()) {
        if (!job.payload || !job.anchor.tx_hash || job.status !== 'anchor_failed' || job.mode !== 'live' || job.error?.code === 'TRANSACTION_REVERTED') continue;
        try {
          const record = await deadline(this.chain.recover(job.anchor.tx_hash, this.input(job)), this.config.chain_timeout_ms);
          if (record) { this.checkRecord(job, record); await this.confirm(job, record.proof); }
        } catch (error) {
          if (safeChainCode(error) === 'TRANSACTION_REVERTED') {
            // A verified reverted receipt is a final outcome, unlike a failed/unknown query.
            job.error = { code: 'TRANSACTION_REVERTED', message: '已确认原交易回滚；报告与交易记录保留，可重新提交生成新任务。' };
            await this.status(job, 'anchor_failed');
            await this.emit(job, 'anchor_error', { error: job.error, tx_hash: job.anchor.tx_hash });
            await this.finish(job);
          }
          // Every other query error retains the unknown outcome and does not authorize a new send.
        }
      }
    } finally { this.recovering = false; }
  }
  async certificate(id: string) {
    if (!this.config.public.contract_address) throw new AppError('CHAIN_NOT_CONFIGURED', 503);
    let record: CertificateRecord;
    const known = [...this.jobs.values()].find((job) => job.mode === 'live' && job.proof?.certificate_id === id &&
      job.proof.chain_id === this.config.public.chain_id &&
      job.proof.contract_address.toLowerCase() === this.config.public.contract_address!.toLowerCase());
    // The saved hash is only a lookup hint. A fresh receipt/event query and full comparison are mandatory.
    try { record = await deadline(this.chain.read(id, known?.proof?.tx_hash), this.config.chain_timeout_ms); }
    catch (error) {
      const code = safeChainCode(error);
      throw new AppError(code, code === 'CERTIFICATE_NOT_FOUND' ? 404 : 503);
    }
    const job = [...this.jobs.values()].find((j) => j.payload && j.mode === 'live' &&
      j.hashes?.verdict_hash.toLowerCase() === record.verdict_hash.toLowerCase());
    if (!job) throw new AppError('REPORT_NOT_FOUND', 404);
    this.checkRecord(job, record, id);
    return { report: { payload: clone(job.payload!), proof: clone(record.proof) }, hashes: clone(job.hashes!) };
  }
  health() {
    return { status: this.storageFailed ? 'degraded' : 'ok', mode: this.config.mode,
      storage_ready: !this.storageFailed, active_jobs: this.tasks.size, queued_jobs: this.queue.length,
      models_ready: this.config.mode === 'demo' || modelsConfigured(this.config.models) || !!(this.config.models.openai?.api_key && this.config.models.openai?.model &&
        this.config.models.anthropic?.api_key && this.config.models.anthropic?.model),
      chain_ready: this.chain.configured, chain_recovery_ready: this.chain.configured && !!this.chain.recover,
      demo: this.config.mode === 'demo' };
  }
  async idle() {
    await this.admission;
    // Admissions schedule pump with setImmediate; allow it to run first.
    await new Promise<void>((resolve) => setImmediate(resolve));
    while (this.tasks.size) await Promise.all([...this.tasks]);
  }
  async close() {
    this.closing = true;
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    await this.admission;
    for (const id of this.queue.splice(0)) {
      const job = this.get(id);
      job.error = { code: 'PROCESS_INTERRUPTED', message: '服务关闭，任务未执行。' };
      await this.status(job, 'interrupted'); await this.finish(job);
    }
    await Promise.all([...this.tasks]);
    await this.recoveryTask;
    this.storeClosed = true;
    try { await this.store.close(); }
    finally {
      if (!this.chainClosed) { this.chainClosed = true; await this.chain.close?.(); }
    }
  }
}
