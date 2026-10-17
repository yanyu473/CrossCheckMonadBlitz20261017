/**
 * Ask both reviewers the same question, at the same time, and keep what they said.
 *
 *   npm run probe -- "待审阅的原文"
 *
 * Every answer is written to data/model-outputs/ as JSON (machine) and Markdown
 * (human). Nothing is invented: a failed slot is recorded as failed.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deriveAgreement, type ModelResult } from '@crosscheck/protocol';
import { createModelAdapters, modelsConfigured, RULE_PROMPT } from '../apps/server/src/adapters.js';
import { loadConfig, ROOT } from '../apps/server/src/config.js';

const DEFAULT_QUESTION = '地球是圆的吗';
const verdictLabel: Record<string, string> = {
  credible: '认为成立',
  questionable: '认为有保留',
  not_credible: '认为不成立',
  unable_to_determine: '无法判断',
};
const agreementLabel: Record<number, string> = { 0: '两家一致', 1: '两家分歧', 2: '至少一方无法判断' };

function stamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function main() {
  const config = await loadConfig();
  const models = { ...config.models, mode: 'live' as const };
  if (!modelsConfigured(models)) {
    console.error('未配置：需要 MODEL_BASE_URL、MODEL_API_KEY、MODEL_A、MODEL_B。');
    process.exit(1);
  }

  const question = process.argv.slice(2).join(' ').trim() || DEFAULT_QUESTION;
  const adapters = createModelAdapters(models);
  console.log(`上游 ${models.upstream?.base_url}  思考档 ${models.upstream?.reasoning_effort ?? '-'}  超时 ${models.timeout_ms}ms`);
  console.log(`问题：${question}\n`);

  const started = Date.now();
  const settled = await Promise.all(adapters.map(async (adapter) => {
    const slotStarted = Date.now();
    const result = await adapter.run(question);
    return { ...result, elapsed_ms: Date.now() - slotStarted };
  }));
  const total = Date.now() - started;

  for (const result of settled) {
    const head = `${result.slot.toUpperCase()} ${result.requested_model}`;
    if (result.status === 'succeeded') {
      console.log(`${head}  →  ${verdictLabel[result.verdict ?? ''] ?? result.verdict}（${result.verdict}）  ${result.elapsed_ms}ms`);
      console.log(`   ${result.reason}`);
    } else {
      console.log(`${head}  →  失败 ${result.error_code}  (${result.elapsed_ms}ms)`);
    }
    console.log('');
  }

  const agreement = deriveAgreement(settled as unknown as [ModelResult, ModelResult]);
  const conclusion = agreement === null ? '两家都失败，不生成报告' : agreementLabel[agreement];
  console.log(`结论：${conclusion}${agreement === null ? '' : `（agreement=${agreement}）`}`);
  console.log(`并行总耗时 ${total}ms`);

  const record = {
    asked_at: new Date(started).toISOString(),
    question,
    rule_prompt: RULE_PROMPT,
    upstream: {
      base_url: models.upstream?.base_url ?? null,
      reasoning_effort: models.upstream?.reasoning_effort ?? null,
      wire_api: models.upstream?.wire_api ?? null,
      http_proxy: models.upstream?.http_proxy ? 'configured' : null,
    },
    elapsed_ms: total,
    agreement,
    conclusion,
    answers: settled,
  };

  const directory = resolve(ROOT, config.data_dir, 'model-outputs');
  await mkdir(directory, { recursive: true });
  const name = stamp(new Date(started));
  await writeFile(resolve(directory, `${name}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  const markdown = [
    `# ${record.asked_at}`,
    '',
    `- 上游：${record.upstream.base_url}`,
    `- 思考档：${record.upstream.reasoning_effort}`,
    `- 并行总耗时：${total}ms`,
    `- 结论：${conclusion}${agreement === null ? '' : `（agreement=${agreement}）`}`,
    '',
    '## 问题',
    '',
    question,
    '',
    '## 两份回答',
    '',
    ...settled.flatMap((result) => [
      `### ${result.slot.toUpperCase()} · ${result.requested_model} · ${result.provider}`,
      '',
      result.status === 'succeeded'
        ? `**${verdictLabel[result.verdict ?? ''] ?? result.verdict}**（\`${result.verdict}\`）— ${result.reason}`
        : `失败：${result.error_code}`,
      '',
    ]),
  ].join('\n');
  await writeFile(resolve(directory, `${name}.md`), `${markdown}\n`, 'utf8');
  console.log(`已保存 ${resolve(directory, name)}.{json,md}`);

  if (settled.every((result) => result.status === 'failed')) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
