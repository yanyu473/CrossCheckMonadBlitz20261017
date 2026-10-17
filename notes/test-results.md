> 历史记录：以下为 A 独立交付时的状态与环境路径。当前集成入口、实现和验证以 [INTEGRATION.md](../INTEGRATION.md) 为准。

# A 阶段验收结果

执行日期：2026-10-17（Asia/Shanghai）。本地运行，未连接项目 GitHub，未调用真实模型或发送交易。

| 检查 | 实际结果 |
| --- | --- |
| npm 依赖安装 | 成功，92 个包，package-lock.json 已生成；官方 registry 连接不稳定后使用 npm 镜像，npm 工具包 SHA-512 校验通过；安装跳过 lifecycle scripts |
| TypeScript strict 检查 | 通过 |
| 自动化测试 | **69 passed / 0 failed / 0 skipped** |
| 固定 demo fixtures 校验 | 三个样本的预期 hash 全通过 |
| protocol 编译 | `tsc -p packages/protocol/tsconfig.json` 通过 |
| 实际后端启动 | 成功，127.0.0.1:3001，MODE=demo |
| 实际 HTTP 冒烟 | 202 提交、分歧结果、晚订阅 SSE、JSON 下载、原文精确保留、篡改检测、相同请求复用全部通过 |
| Monad RPC 只读检查 | eth_chainId 返回 0x279f = 10143；不是部署/上链 |

执行入口：`./scripts/local.ps1 Check` 与 `./scripts/local.ps1 Smoke`。Node v24.19.0、npm 10.9.4、TypeScript 5.9.3；Windows 环境。

首次在 Codex 沙箱运行时，回环 HTTP 被 EACCES 拒绝、临时目录原子 rename 被 EPERM 拒绝。相同测试在授权的本机执行环境重跑全部通过；没有为绕开测试而取消原子写入或把 HTTP 替换成伪响应。

## 测试覆盖

- Ethereum Keccak 官方常见向量，区分 SHA3-256；RFC8785 数值、转义、UTF-16 键排序；孤立代理项与非 JSON 值拒绝。
- 原文空格/CRLF/Unicode 形式保持；正常 JSON、改排版、改原文和改模型理由的指纹差异。
- agreement 一致、分歧、无法判断、单边失败；双边失败无正常报告。
- 两家 SDK 请求结构、同规则同原文、返回模型 ID、严格响应解析、拒答/截断、独立超时、取消、错误脱敏、live 不回退 demo。
- 202 返回、SSE 晚订阅与 Last-Event-ID 补发、下载、公开配置不泄密、无真实部署时凭证 API 不伪造成功、输入限长与限流。
- 同时 12 个相同请求只建一个任务；缓存复用原时间；模型配置变化失效；降级/失败不进普通缓存；2 并发+1 队列上限。
- 原子快照、单进程锁、损坏快照拒绝、重启中断、已确认但未写完 done 的恢复。
- 本地 mock 链成功/失败，错链/合约/issuer/内容 hash/报告 hash/agreement/交易/id 拒绝；每次凭证下载读取 gateway。
- 广播回调落盘、确认超时、只读恢复、不重发；未知广播结果重复请求保护；超时底层 writer 未结束时阻止并发钱包调用。

## 真实 HTTP 冒烟记录

该记录仅是本机 demo，proof=null，没有真实模型或测试网交易：

```json
{
  "result": "PASS",
  "mode": "demo",
  "job_id": "ad289df7-3ce3-4401-b784-738e628ba0d0",
  "content_hash": "0x5c6855cf9905a11fa3678fab21f632e805d29d5f35d9d77aaeaa64c46563417b",
  "verdict_hash": "0x7ccad59ead8586fc5090dbe934d5eebb79107393c762cf557bead3d804ba7555",
  "proof": null
}
```

health 返回 status=ok、storage_ready=true、mode=demo、chain_ready=false、chain_recovery_ready=false。本机 WLAN 地址为 `192.168.31.96`（核验时值，可能随网络变化）；当前仅监听回环。B 联调须设 HOST=0.0.0.0 后启动，再代理到 A 的实际局域网 IP。

## 尚未验收

真实 OpenAI/Anthropic 模型调用、真实 Monad 合约/交易、B 网页三页面和真实链导入复核、GitHub 推送/合并。没有凭证时不会伪造这些结果。MOJO 提交由团队完成；contract.dev 不作为当前前提。
