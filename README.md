# CrossCheckMonadBlitz20261017 · CrossCheck

以 A 的共享协议和后端为主入口，接入 B 的四页面界面、Solidity 合约和链上核验。双方提交历史和原有实现均保留；B 原后端通过 start:legacy 单独运行。

## 在线演示

[打开 CrossCheckMonadBlitz20261017](https://yanyu473.github.io/CrossCheckMonadBlitz20261017/) · [项目说明](https://yanyu473.github.io/CrossCheckMonadBlitz20261017/about.html) · [站点地图](https://yanyu473.github.io/CrossCheckMonadBlitz20261017/sitemap.xml)

公开站回放三份**真实调用产物**（判断与理由均为模型原始返回，未改写），已分别签发 Monad 测试网凭证 #10–#12，覆盖"两家一致／两家分歧／两家均拒绝判断"三种结局；支持报告导出、浏览器复算指纹与直接读 RPC 核验。任意文字的实时审阅需要运行下方完整 Node 服务并配置模型通道。

## 运行

Node.js 22+，在仓库根目录执行：

```sh
npm ci
npm run check
npm start
```

打开 http://localhost:3001 。无需 Key 的默认 demo 使用明确标识的固定模型结果，报告 proof=null，不发送交易。原文按输入原始字节计算哈希，前端与服务端均使用 packages/protocol。

需要配置时复制 .env.example 到 .env。真实双模型模式（`MODE=live`）支持两种接法：**同一个上游网关**（`MODEL_BASE_URL` + `MODEL_API_KEY` + `MODEL_A` + `MODEL_B`，两个评审方只有 model id 不同），或两家厂商各自凭据（`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`）。两个模型应来自不同家族，否则"两份独立意见"没有意义。不同模型接受的思考档往往不同，可分别用 `MODEL_A_REASONING_EFFORT` / `MODEL_B_REASONING_EFFORT` 指定；单次请求超时用 `MODEL_REQUEST_TIMEOUT_MS`（默认 20s，中转不流式返回时需要调高）。实际存证另需 `CHAIN_ENABLED=true`、`ISSUER_PRIVATE_KEY` 和 deployment.json；浏览器只读 RPC。私钥、Key、运行报告不提交。

## 实现

- apps/server：A 的队列、缓存、SDK 适配器、持久化、SSE、下载与恢复。默认端口3001，同时提供 B 页面。
- packages/protocol：A 的唯一共享类型、schema、规范序列化与哈希。
- packages/chain：B 链实现对 A 接口的适配，包含独立 server/browser 入口。
- apps/web/src 与根 HTML/JS：B 界面，构建时注入共享协议与只读链模块。
- server.ts、server/、protocol.ts、types.ts：保留的 B 原实现；npm run start:legacy 启动，npm run demo:legacy 使用本地 EVM。默认产品不使用这些协议副本。
- docs/ 与 showcase/：真实调用产物的静态回放（两份内容必须逐字节一致，由 tests/integration-fixtures.test.ts 守护）。

API 和字段以 [共享接口](notes/interface-contract.md) 为准。集成说明见 [INTEGRATION.md](INTEGRATION.md)，A/B 原说明保存在 [notes/history](notes/history)。内部交接记录统一放在 `notes/`（不参与 Pages 发布）。

## 证明边界

报告指纹匹配只证明"这份报告确实被签发、且内容与签发时一致"，不证明判断本身正确，也不构成模型厂商签名。

真实模型通道已于 2026-10-17 实测跑通并留证：三份公开样例即当次调用的产物（A 槽 `gpt-6-sol`、B 槽 `claude-opus-5-5`，经同一上游网关并行调用），凭证 #10–#12 已上链，`npm run probe -- "问题"` 可当场复现调用并把结果写入 `data/model-outputs/`。现有 Monad 测试网公开部署记录见 deployment.json，静态回放中的报告与该合约匹配。

需要提醒的是：本仓库的两个评审方共用一家上游网关，因此**不具备"两家厂商各自签名"的可信度**——它提供的是"同一关口下两份模型意见的独立记录"，不要当成双厂商背书来读。
