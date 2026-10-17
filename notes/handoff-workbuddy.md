> 历史记录：以下为 A 独立交付时的状态与环境路径。当前集成入口、实现和验证以 [INTEGRATION.md](../INTEGRATION.md) 为准。

# WorkBuddy 本地交接

## 唯一工作目录

```text
C:\Users\l6179\Documents\Codex\2026-10-17\monad-https-docs-monad-xyz-developer-2\CrossCheckMonadBlitz20261017
```

用户确认起初没有已有本地仓库。本轮在上述目录创建项目，跳过所有 GitHub 认证、clone/fetch/push 与合并；未初始化 `.git`，没有本地 commit/分支/远程状态可以声称已完成。固定目标仍为用户指定的 `LINXIAO-LI2025/CrossCheckMonadBlitz20261017`，后续由 WorkBuddy 决定如何接入该远程并保留远程 README/LICENSE。不要用新建的本地历史强制覆盖远程初始历史。

## 改动清单

- 根 package.json/package-lock.json、tsconfig.json、.gitignore、.env.example：npm workspace 与本地运行配置。
- apps/server：OpenAI/Anthropic 独立 adapter、demo fixtures 模式、8 个 API、任务队列、超时/失败降级、原子快照、缓存、SSE 历史补发、报告下载、链记录核对/恢复接缝及测试。
- packages/protocol：共享类型、严格 schema、RFC8785 语义规范序列化、Keccak-256、固定正常/篡改样本与测试。
- apps/web/package.json：仅公共骨架，B 负责实现。
- packages/chain：仅 server/browser 的 NOT_CONFIGURED 初始占位与接口，B 负责实现真实模块。
- scripts/smoke.ts、README 与 docs：无网页冒烟测试、API、A/B 接缝、开发资源和交接。

## 提交前处理

1. 在本机运行 `npm ci`、`npm run check`、`npm run fixtures:check -w @crosscheck/protocol`。
2. 检查变更清单，选择源文件、package-lock、文档和已标注 demo fixtures；不要直接把整个上级 work 或 outputs 目录提交。
3. 禁止提交 node_modules、真实 .env/.env.*、私钥、Key、keystore、运行 data/reports、缓存/日志、.runtime。`.env.example` 可提交。
4. B 到位后先对照 docs/chain-integration.md 与共享接口，保留 B 的网页/链代码；A 统筹最终根锁文件，避免整个目录覆盖。
5. GitHub 提交推送与 main 合并本轮均未执行。不要把本地测试通过描述为云端已交付或网页已上线。

## 需在最终运行机器本地配置

根 `.env`：MODE=live，以及 OPENAI_API_KEY、OPENAI_MODEL、ANTHROPIC_API_KEY、ANTHROPIC_MODEL。真实上链另需 B 的模块和 deployment.json、CHAIN_ENABLED=true、ISSUER_PRIVATE_KEY。不要在聊天粘贴秘密；不要将真实 .env 随分支传递。

## 未完成的外部验收

B 网页和真实合约/writer；两家真实模型请求；真实测试网交易/凭证；三页面与真实下载篡改复核；WorkBuddy 后续 GitHub 上传。MOJO 团队自行报名提交。contract.dev Monad 支持仍待现场确认，不阻塞开发。

本轮测试结果见 [test-results.md](test-results.md)。测试中的链 proof 是纯本地 mock，固定报告是 demo；公开 RPC 的 chainId 只读检查也不是上链。
