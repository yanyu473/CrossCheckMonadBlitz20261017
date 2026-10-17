import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { PublicConfig } from '@crosscheck/protocol';
import type { ModelAdaptersConfig } from './adapters.js';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export interface ServerConfig {
  mode: 'live' | 'demo'; host: string; port: number; data_dir: string;
  max_input_chars: number; rate_limit: number; max_concurrent: number; max_queue: number;
  cache_ttl_ms: number; chain_timeout_ms: number; recovery_interval_ms: number;
  models: ModelAdaptersConfig; public: PublicConfig;
  chain_enabled: boolean; rpc_url: string; private_key?: string; deployment: Record<string, unknown> | null;
}
function int(env: NodeJS.ProcessEnv, key: string, fallback: number, min = 1, max = 2_147_483_647) {
  const n = Number(env[key] ?? fallback);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid ${key}`);
  return n;
}

/**
 * One relay, two model ids, one key. Both reviewers are the same upstream;
 * nothing is inferred, everything comes from the environment.
 */
function readUpstream(env: NodeJS.ProcessEnv): ModelAdaptersConfig['upstream'] {
  const base_url = env.MODEL_BASE_URL?.trim();
  const api_key = env.MODEL_API_KEY?.trim();
  const model_a = env.MODEL_A?.trim();
  const model_b = env.MODEL_B?.trim();
  if (!base_url && !api_key && !model_a && !model_b) return undefined;
  if (base_url && !/^https?:\/\//i.test(base_url)) throw new Error('Invalid MODEL_BASE_URL');
  const wire = env.MODEL_WIRE_API?.trim() || 'auto';
  if (!['chat', 'responses', 'auto'].includes(wire)) throw new Error('Invalid MODEL_WIRE_API');
  return {
    base_url, api_key, model_a, model_b,
    model_a_fallback: env.MODEL_A_FALLBACK?.trim() || undefined,
    model_b_fallback: env.MODEL_B_FALLBACK?.trim() || undefined,
    reasoning_effort: env.MODEL_REASONING_EFFORT?.trim() || 'minimal',
    reasoning_effort_a: env.MODEL_A_REASONING_EFFORT?.trim() || undefined,
    reasoning_effort_b: env.MODEL_B_REASONING_EFFORT?.trim() || undefined,
    http_proxy: env.MODEL_HTTP_PROXY?.trim() || undefined,
    request_timeout_ms: env.MODEL_REQUEST_TIMEOUT_MS ? int(env, 'MODEL_REQUEST_TIMEOUT_MS', 20_000, 1_000, 600_000) : undefined,
    wire_api: wire as 'chat' | 'responses' | 'auto',
    provider_label: env.MODEL_PROVIDER_LABEL?.trim() || 'upstream',
  };
}
export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<ServerConfig> {
  if (env === process.env) dotenv.config({ path: resolve(ROOT, '.env'), quiet: true });
  const mode = env.MODE ?? 'demo';
  if (mode !== 'demo' && mode !== 'live') throw new Error('MODE must be demo or live');
  const port = int(env, 'PORT', 3001, 1, 65535);
  if (env.CHAIN_ENABLED && !['true', 'false'].includes(env.CHAIN_ENABLED)) throw new Error('Invalid CHAIN_ENABLED');
  const chain_enabled = env.CHAIN_ENABLED === 'true';
  let deployment: Record<string, unknown> | null = null;
  try {
    deployment = JSON.parse(await readFile(resolve(ROOT, env.DEPLOYMENT_FILE ?? 'deployment.json'), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Invalid deployment file');
  }
  if (deployment && (deployment.chainId !== 10143 ||
    !/^0x[0-9a-fA-F]{40}$/.test(String(deployment.contract ?? deployment.contractAddress)) ||
    !/^0x[0-9a-fA-F]{40}$/.test(String(deployment.issuer)) || !Array.isArray(deployment.abi) ||
    !/^(0|[1-9][0-9]*)$/.test(String(deployment.deploymentBlock)) ||
    (typeof deployment.deploymentBlock === 'number' && !Number.isSafeInteger(deployment.deploymentBlock)) ||
    /^0x0{40}$/i.test(String(deployment.contract ?? deployment.contractAddress)) ||
    /^0x0{40}$/i.test(String(deployment.issuer)))) throw new Error('Invalid Monad testnet deployment');
  const publicConfig: PublicConfig = {
    mode, public_origin: env.PUBLIC_ORIGIN ?? `http://localhost:${port}`, chain_id: 10143,
    contract_address: deployment ? String(deployment.contract ?? deployment.contractAddress) : null,
    deployment_block: deployment ? BigInt(String(deployment.deploymentBlock)).toString() : null,
    issuer: deployment ? String(deployment.issuer) : null,
    explorer_tx_base_url: 'https://testnet.monadscan.com/tx/',
  };
  return {
    mode, host: env.HOST ?? '127.0.0.1', port,
    data_dir: resolve(ROOT, env.DATA_DIR ?? 'data'), max_input_chars: int(env, 'MAX_INPUT_CHARS', 12000, 1, 1_000_000),
    rate_limit: int(env, 'RATE_LIMIT_PER_MINUTE', 20), max_concurrent: int(env, 'MAX_CONCURRENT_JOBS', 2, 1, 100),
    max_queue: int(env, 'MAX_QUEUE_SIZE', 20, 0, 10000), cache_ttl_ms: int(env, 'CACHE_TTL_MS', 3600000, 0),
    chain_timeout_ms: int(env, 'CHAIN_TIMEOUT_MS', 30000), recovery_interval_ms: int(env, 'RECOVERY_INTERVAL_MS', 15000),
    chain_enabled, deployment, public: publicConfig,
    rpc_url: env.MONAD_RPC_URL ?? 'https://testnet-rpc.monad.xyz', private_key: env.ISSUER_PRIVATE_KEY,
    models: { mode, timeout_ms: int(env, 'MODEL_TIMEOUT_MS', 20000), upstream: readUpstream(env),
      openai: { api_key: env.OPENAI_API_KEY, model: env.OPENAI_MODEL },
      anthropic: { api_key: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL } },
  };
}
