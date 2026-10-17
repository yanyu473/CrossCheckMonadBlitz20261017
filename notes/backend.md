# 后端运行与联调

## 命令

在项目根目录 `npm ci`，然后 `npm start`；开发用 `npm run dev:server`。无需 `.env` 默认显式 demo。检查 `GET /api/health` 的 mode，不要把 demo 截图当成真实模型验收。

PowerShell 无页面操作：

```powershell
$api = 'http://127.0.0.1:3001'
$body = @{ content = '[demo:disagree] 测试主张' } | ConvertTo-Json
$job = Invoke-RestMethod "$api/api/verify" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
$job
Invoke-RestMethod "$api/api/jobs/$($job.job_id)"
curl.exe -N "$api$($job.stream_url)"
Invoke-WebRequest "$api/api/jobs/$($job.job_id)/report" -OutFile 'local-report.json'
```

`npm run smoke` 自动完成类似流程，不写报告文件。自定义目标用 `API_BASE_URL`；该脚本强制要求 demo，避免误耗额度。源码从 `.env` 读取根目录配置，不因 npm workspace 的当前目录不同而漏读。

## 五种 demo 场景

原文以以下标记开头（标记也属于收到的原文，会保存并参与 hash）：

| 前缀 | 结果 |
| --- | --- |
| `[demo:agree]` 或普通文本 | 两边成功相同，agreement=0 |
| `[demo:disagree]` | 两边成功不同，agreement=1 |
| `[demo:unable]` | b 无法判断，agreement=2 |
| `[demo:single-failure]` | b 接口失败，a 保留，agreement=2 |
| `[demo:both-failure]` | failed，无正常报告/凭证 |

所有 demo 模型的 provider 都是 `demo-fixture`，reason 明示固定样本。无效前缀按默认 agree 样本处理，不做内容真实性推断。

示例提交响应：

```json
{"job_id":"生成的UUID","status":"queued","stream_url":"/api/stream/生成的UUID","reused":false}
```

完成的 demo JobView 的关键字段是 `mode:"demo",status:"report_ready",proof:null,error:null`，payload 含原文、真实本地提交/完成时间和固定样本判断。完整的静态 JSON 示例在 `packages/protocol/fixtures/normal.demo.json`；它有固定时间和预期 hash，不能当成新模型调用。

## API / SSE

全部路由、事件和错误码见 [interface-contract.md](interface-contract.md)。POST 即刻返回 202；`reused=true` 表示合并进行中请求、复用有效缓存，或保护未明广播结果。缓存命中保留原 job_id、原 payload 和原时间。

典型事件顺序：queued/running → 两个 model_result 或 model_error → report_ready → live 的 anchoring/anchor_submitted/anchor_confirmed 或 anchor_error → done。两个模型的事件按实际完成先后到达，但结果数组总是 a/b。模型逐字流式未实现，不能解析半截 JSON 作为正式结果。

连接可晚订阅。SSE 所有事件先持久化再通知客户端；支持 Last-Event-ID；成功 done 后服务关闭当前流。待确认交易恢复后会追加新事件，前端使用 GET job 或重新订阅。页面不可把 done 或 report_ready 当成已上链。

下载内容只有 `{payload,proof}`，hash 可通过共享模块复算；hash 不写入 payload。`/api/jobs/:id/report` 不要求已上链；`/api/cert/:id/report` 必须重新读取并核验已知真实链记录。浏览器导入的 proof 不是可信来源。

## 配置

| 变量 | 默认值/用途 |
| --- | --- |
| MODE | demo，只有显式 live 才请求模型 |
| HOST / PORT | 127.0.0.1 / 3001；A 供 B 访问时 HOST=0.0.0.0 |
| PUBLIC_ORIGIN | http://localhost:3001，随PORT变化；可显式配置前端公开地址 |
| DATA_DIR | 根目录 data；单进程独占 |
| MAX_INPUT_CHARS | 12000，JS UTF-16 code units；原文不 trim 保存 |
| RATE_LIMIT_PER_MINUTE | 每实际连接 IP 20 次，不信客户端 X-Forwarded-For |
| MAX_CONCURRENT_JOBS / MAX_QUEUE_SIZE | 2 个正在处理任务 + 20 个排队任务 |
| MODEL_TIMEOUT_MS | 每模型独立 20000ms，SDK 自动重试关闭 |
| CACHE_TTL_MS | 3600000；0 禁用完成报告缓存，进行中仍合并 |
| CHAIN_TIMEOUT_MS | 30000；超时保留报告和广播记录 |
| RECOVERY_INTERVAL_MS | 15000，仅对持有 tx_hash 的失败存证任务只读恢复 |
| OPENAI_API_KEY / OPENAI_MODEL | 本机填写 Key 和账户实际支持模型 ID |
| ANTHROPIC_API_KEY / ANTHROPIC_MODEL | 第二家厂商配置；缺配置明确 failed |
| CHAIN_ENABLED | false；B 完成真实模块后显式启用 |
| MONAD_RPC_URL | https://testnet-rpc.monad.xyz |
| DEPLOYMENT_FILE | 根目录 deployment.json；B 提供 |
| ISSUER_PRIVATE_KEY | 只在后端本地填，不进入前端/报告/日志 |

两个厂商接收同一固定规则与相同原文，彼此看不到答案。OpenAI 使用 Responses 的 JSON Schema structured output；Anthropic 强制一个结构化工具响应；都严格验证 verdict/reason、拒绝截断/拒答/额外字段/无效 Unicode。返回模型名称照实记录，响应解析失败不是可信意见。

配置 hash 包含不含 Key 的模型配置，prompt_hash 对应 `RULE_PROMPT` 字节。普通降级/失败不进入成功缓存。已尝试广播但结果未明的同键任务保护性复用；不是把失败模型结果当成功缓存。

## 持久化与恢复

每个任务一个 JSON 原子快照（tmp 写入、fsync、rename），所有更新串行。记录包括 payload、hash、事件、attempted_at、tx_hash 与 proof，重建索引不依赖另一个易损共享索引。服务启动校验 schema、hash、事件序号和结果一致性；损坏数据明确拒绝启动，不能静默当成功。

队列/模型未完成任务重启标 interrupted；已固定 demo 报告恢复为可下载；已确认但没写完 done 的报告保留 confirmed。真实交易若已有 tx_hash，只调用 B 的 recover；没有 tx_hash 但已尝试 writer，标 BROADCAST_OUTCOME_UNKNOWN，不自动发送。

`.server.lock` 阻止多实例写同一个 data 目录；PID 已不存在才回收可识别的旧锁。若锁为空/损坏，先确认没有服务进程，再人工保存并排查锁文件，不能启动第二个 writer 试碰运气。SIGINT/SIGTERM 等待正在执行的任务与恢复查询，再释放锁。

writer 的超时包装不能取消任意底层 RPC。A 单独追踪尚未结束的 writer 调用，期间新报告标 `CHAIN_WRITER_BUSY`，不并发调用赞助钱包。B 必须对 SDK/RPC 实现自己的有限超时，等待广播回调完成，且不得在返回之后继续发交易。已关闭存储的迟到回调会被拒绝，attempt marker 保留便于人工查询未知结果。

## 运行边界

请求/响应与原文不写控制台，厂商异常正文不进入日志/报告。没有上传密钥的 API，没有运行态切换到 mock chain 的开关。只测试代码可注入 mock gateway。

公共 health 的 models_ready 仅代表配置齐备，不代表网络调用或额度已验证；chain_ready 仅代表 B writer 和配置就绪，不能代替真实交易测试。OpenAI/Anthropic live 与 B 真链验证需后续本地配置后执行。

A/B已集成四页和链模块；当前入口与验收结果见根目录INTEGRATION.md。默认demo不广播；真实模型和真实网络存证需要有效配置。
