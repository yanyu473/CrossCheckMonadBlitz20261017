import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { hashContent, hashPayload, validateReportEnvelope } from '@crosscheck/protocol';
import { computeHashes as legacyHashes } from '../protocol.js';

test('B historical anchored fixtures preserve hashes under A shared protocol and rebuilt showcase bundle', async () => {
  const samples = JSON.parse(await readFile(new URL('../docs/samples.json', import.meta.url), 'utf8'));
  assert.equal(await readFile(new URL('../docs/samples.json', import.meta.url), 'utf8'), await readFile(new URL('../showcase/samples.json', import.meta.url), 'utf8'));
  const context = vm.createContext({ TextEncoder, TextDecoder, Uint8Array });
  vm.runInContext('globalThis.window = globalThis;', context);
  vm.runInContext(await readFile(new URL('../docs/shared.js', import.meta.url), 'utf8'), context);
  for (const sample of samples) {
    const report = validateReportEnvelope(sample.report);
    // 样例自 2026-10-17 起是真实调用产物，mode 记为 live；demo 仍允许，因为
    // 页面必须能同时回放两条路径。这里守住的是"模式必须被明确标注"，不是某一种取值。
    assert.ok(['live', 'demo'].includes(report.payload.mode), `unexpected mode ${report.payload.mode}`);
    if (report.payload.mode === 'live') {
      for (const model of report.payload.models) assert.equal(model.status, 'succeeded', 'live sample must carry two real answers');
    }
    assert.equal(report.proof?.chain_id, 10143);
    const hashes = { content_hash: hashContent(report.payload.raw_text), verdict_hash: hashPayload(report.payload) };
    assert.deepEqual(hashes, legacyHashes(report.payload));
    assert.equal(context.ShowcaseProtocol.validateReportEnvelope(sample.report).valid, true);
    // JSON downloads are parsed in the browser realm, not passed as Node object prototypes.
    context.payloadJson = JSON.stringify(report.payload);
    const browserHashes = vm.runInContext('ShowcaseProtocol.computeHashes(JSON.parse(payloadJson))', context);
    assert.equal(browserHashes.content_hash, hashes.content_hash);
    assert.equal(browserHashes.verdict_hash, hashes.verdict_hash);
    const tampered = structuredClone(report.payload);
    tampered.models[0].reason += ' tampered';
    assert.notEqual(hashPayload(tampered), hashes.verdict_hash);
  }
  assert.equal(samples.length, 3);
});
