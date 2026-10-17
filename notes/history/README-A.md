# CrossCheck · 双模型交叉核对

2026-10-17 从零编写的 Monad Blitz A 台交付：两个不同厂商模型独立判断同一段文本，保存固定 JSON 报告，交给 B 的 Monad 测试网模块存证。模型意见一致不代表事实正确；报告指纹匹配也不证明模型调用过程真实发生。

当前可运行的是 A 后端与共享协议。`apps/web` 及 `packages/chain` 是供 B 接手的最小骨架，链占位明确抛出 `NOT_CONFIGURED`。没有真实网页、合约、部署地址或模拟成功交易。默认 demo 不调用真实模型，也不广播交易。

## 安装与运行

需要 Node.js >= 22 与 npm。所有命令在本目录执行：

```sh
npm ci
npm run check
npm start
```

后端默认 `http://127.0.0.1:3001`。另开终端执行 `npm run smoke`，可验证提交、SSE、下载、哈希和重复请求复用，无需网页或 Key。开发时使用 `npm run dev:server`。

本机依赖已安装后，Windows 无需 npm 命令也可执行 `./scripts/local.ps1 Start`、`./scripts/local.ps1 Check`、`./scripts/local.ps1 Smoke`。脚本优先使用 PATH 中的 Node，缺失时查找 Codex 自带 Node。

默认无 `.env` 也可启动 demo。需要覆盖配置时复制 `.env.example` 到根目录 `.env`。在 Windows PowerShell 中可用 `Copy-Item .env.example .env`。真实 `.env`、Key、私钥和运行数据均不提交。

```sh
curl -X POST http://127.0.0.1:3001/api/verify -H "Content-Type: application/json" -d '{"content":"[demo:disagree] example claim"}'
curl http://127.0.0.1:3001/api/jobs/JOB_ID
curl -N http://127.0.0.1:3001/api/stream/JOB_ID
curl -o report.json http://127.0.0.1:3001/api/jobs/JOB_ID/report
```

PowerShell 可使用 `curl.exe`，或见 [backend.md](docs/backend.md) 的原生命令。

## 本地模式与真实模式

- `MODE=demo`：确定性 fixture；五种前缀见后端文档。报告 `mode=demo`、`proof=null`，不会调用链 writer。
- `MODE=live`：必须在本机配置 `OPENAI_API_KEY`、`OPENAI_MODEL`、`ANTHROPIC_API_KEY`、`ANTHROPIC_MODEL`。模型 ID 由账户可用列表选择，不内置猜测的名称。每个模型独立超时、无 SDK 自动重试，live 故障不会切换 demo。
- B 尚未接入时，live 的有效报告保留且显示 `anchor_failed / NOT_CONFIGURED`。不是已经上链。
- 真实存证另需 B 实现模块、`deployment.json`、`CHAIN_ENABLED=true`、`ISSUER_PRIVATE_KEY`。私钥只能由服务器读取；MOJO 不接入应用，contract.dev 不构成前置依赖。

## 分工与文件

| 目录 | 负责方 | 内容 |
| --- | --- | --- |
| `apps/server` | A | Express、双模型 adapter、任务/缓存/SSE/下载、文件持久化、链调用接缝 |
| `packages/protocol` | A | 类型、schema、规范序列化、Keccak、固定 demo fixtures |
| `apps/web` | B | 目前只有 package.json；B 实现网页 |
| `packages/chain` | B | 目前仅不配置占位；B 实现 server/browser 入口 |
| `contracts` | B | A 未创建合约或部署脚本 |
| 根依赖与文档 | A | workspace、锁文件、运行和交接说明 |

共享协议：[interface-contract.md](docs/interface-contract.md)。后端运行/API：[backend.md](docs/backend.md)。链集成：[chain-integration.md](docs/chain-integration.md)。主办方资源：[development-resources.md](docs/development-resources.md)。WorkBuddy 交接：[handoff-workbuddy.md](docs/handoff-workbuddy.md)。

## B 联调与手机访问

后端 `.env` 设 `HOST=0.0.0.0` 后启动；终端会打印本机 IPv4 地址。B 的 Vite 代理把 `/api` 指向 **A 机器的局域网 IP:3001**，不要指向 B 自己的 localhost。手机访问 B 的前端 IP:5173，前端使用相对 `/api`，只在受信任局域网演示。Windows 防火墙如阻挡需在本机放行相应端口。

`npm run dev:web` 当前无页面可启动；B 添加自己的 dev 脚本后分别开两个终端运行 `npm run dev:server` 与 `npm run dev:web`。A 没有伪装三页面联调已完成。

## 测试与局限

`npm run check` 运行 TypeScript 与协议、adapter、HTTP、任务恢复测试；所有测试链记录仅为测试代码中的 mock。`npm run fixtures:check -w @crosscheck/protocol` 核对固定 fixture 哈希，`npm run build -w @crosscheck/protocol` 验证共享包可编译。

数据在 `data/` 中按任务原子写入，单进程独占锁；不支持多实例共享目录。重启恢复完成报告，未完成模型任务标记中断，已尝试广播的任务不自动重发。尚未恢复的交易重复提交会复用原任务，避免重复扣额度或发交易。SSE `done` 仅代表当次处理结束，确认恢复后可再订阅/查询。

服务默认无账号系统，公开部署前应另行安排访问控制；当前仅按比赛局域网演示范围运行。报告含用户提交的原文，勿提交敏感内容。接口限流、长度、并发和队列上限可在 `.env` 调整。

本轮按用户要求没有初始化 Git、连接 GitHub、克隆、提交或推送；后续由 WorkBuddy 从本目录处理。
