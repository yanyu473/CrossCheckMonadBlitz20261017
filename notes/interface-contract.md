# A/B 共享协议 v1

以 `packages/protocol/src/types.ts` 与 `schema.ts` 为唯一可执行定义。字段统一 snake_case；B 直接导入 `@crosscheck/protocol`，不要另写哈希算法。`validateReportEnvelope(value)` 返回校验后的对象或抛异常；页面可用 `safeParseReportEnvelope` 显示错误。

## 数据与哈希

- `Verdict`：`credible | questionable | not_credible | unable_to_determine`。
- `ModelResult`：`slot, provider, requested_model, returned_model, status, verdict, reason, error_code`。固定 a 在前、b 在后。成功时 verdict/reason 有值、error_code=null；失败 verdict/reason=null。模型无法判断是有效结果。仅缺少模型配置的 `failed / NOT_CONFIGURED` 可用空 requested_model。
- `ReportPayload`：`schema_version:'1', job_id, mode, raw_text, submitted_at, completed_at, rule_version, prompt_hash, model_config_hash, models:[a,b], agreement`。
- `ReportEnvelope`：`{payload, proof}`。proof 为 null 或 `chain_id, contract_address, certificate_id, issuer, tx_hash, block_number, block_time`。大整数使用十进制字符串。
- `JobView`：`job_id, mode, status, results, payload, hashes, proof, error`。A 兼容扩展 `anchor:{attempted_at,tx_hash}`，B 可用它展示待确认交易。

agreement：两边成功且均非无法判断，结论相同为 0，不同为 1；任一无法判断或只有一边成功为 2；两边都失败时 `deriveAgreement` 返回 null，任务 failed，不生成正常 payload 或凭证。

`content_hash = Keccak-256(UTF-8(raw_text))`。trim 仅检查空白，原文空格、换行、Unicode 不规范化。无效 Unicode 孤立代理项被拒绝。

`verdict_hash = Keccak-256(UTF-8(canonicalizePayload(payload)))`，使用 RFC 8785 语义（键按 UTF-16 排序、有限数值、JSON 转义），不是 SHA3-256。payload 固定后不再更改，proof 和自身 hash 都不属于 payload。模型请求配置 hash 不含 Key，但包含模式、厂商、模型 ID、adapter 版本、输出上限和超时；prompt_hash 取固定规则全文。

## API

| 请求 | 正常响应 |
| --- | --- |
| `POST /api/verify`，`{content:string}` | 202 `{job_id,status,stream_url,reused}`；不等待模型或链确认 |
| `GET /api/jobs/:job_id` | JobView，含兼容 anchor 字段 |
| `GET /api/stream/:job_id` | SSE，重放历史再订阅新事件 |
| `GET /api/jobs/:job_id/report` | JSON 附件 `{payload,proof}`；未生成 409，未存证 proof=null |
| `GET /api/cert/:id` | 每次读取已知部署后返回 `{report,hashes}`；不返回文件自证 |
| `GET /api/cert/:id/report` | 同样先读链验证，再下载 ReportEnvelope |
| `GET /api/config` | `mode,public_origin,chain_id,contract_address,deployment_block,issuer,explorer_tx_base_url` |
| `GET /api/health` | 模式、存储/模型/链接口是否就绪、当前队列；不暴露 Key |

错误统一 `{error:{code,message}}`。400 输入/JSON/Unicode/事件游标非法；404 任务或凭证不存在；409 报告未准备/链记录不匹配；413 长度超限；429 限流/队列满；503 链未配置/不可查询。chain_id 的公开默认值是测试网 10143；没有部署时地址、区块、issuer 为 null。

## SSE

```text
id: 4
event: model_result
data: {"job_id":"...","slot":"a","result":{...}}

```

每条事件有递增整数 id，data 必有 job_id；模型事件另有 slot。`Last-Event-ID` 只补发更大的 id；首次订阅重放所有历史，不能假设只会收到新事件。`model_result` 含 result；`model_error` 含失败 result 和 error；`report_ready` 含 payload/hashes；`anchor_submitted` 含 tx_hash；`anchor_confirmed` 含 proof；`anchor_error` 含 error 与可选 tx_hash；`job_status`/`done` 含 status。`model_delta` 保留为可选扩展，当前只发完整模型结果。

状态：queued → running → report_ready → anchoring → confirmed。双模型失败 → failed；存证故障 → anchor_failed；重启未完成任务 → interrupted。demo 停在 report_ready，proof=null。done 只表示这次处理结束，不等于 confirmed。恢复链确认后持久化追加新事件；终端事件后的连接会关闭，B 需显式重连或轮询任务状态。

SSE 晚订阅的历史可能包含 earlier done 与后来恢复事件，客户端必须处理完整重放；最终状态以最后的 job_status / GET job 为准。支持最多 100 个同时连接，慢客户端断开后可用游标重连。

## 固定复核样本

`packages/protocol/fixtures/normal.demo.json`、`tampered.demo.json`、`reason-tampered.demo.json` 与 `expected-hashes.json`。全部标明 demo，proof=null；这些样本只验证离线哈希一致性，不是链上凭证。B 的导入复核流程必须在共享 schema/hash 之后，读取已知真实部署进行比对；网络失败显示无法完成链上核对。

## 链接口

见 [chain-integration.md](chain-integration.md)。基础 `anchor(input,onBroadcast)` 与两个读取入口保持任务说明一致。为未返回 certificate_id 的广播恢复增加可选 `recover(tx_hash,input)`；只能读回执，不能重新发交易。链模块已接入。A Gateway内部另支持read(id,tx_hash?)定位已保存的交易和close()释放provider；每次仍重新读链验证。

## 集成兼容扩展

GET /api/jobs/latest 返回最新JobView或null；GET /api/qr?text=本项目页面URL返回PNG。HTTP配置追加backend_mode、live_available、chain_ready，不改变共享publicConfigSchema七个核心字段；前端先摘核心字段严格校验。默认同源页面与API均在3001。
