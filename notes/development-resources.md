# 主办方资源核验与 A/B 交接

核验日期：2026-10-17（Asia/Shanghai）。本说明只记录公开资料与只读 RPC 检查，不代表真实模型调用、合约部署或交易上链已完成。

## 本轮采用的资源

| 资源 | 已核验用途 | 本项目处理 |
| --- | --- | --- |
| [Monad Developer Essentials](https://docs.monad.xyz/developer-essentials) | 官方开发文档入口 | 网络、交易和部署配置优先使用官方文档。 |
| [测试网网络信息](https://docs.monad.xyz/developer-essentials/testnet) | 测试网、RPC、水龙头与重置说明 | 使用测试网专用页面；`/developer-essentials/network-information` 当前是主网页面。官方注明测试网在 2025-12-16 从创世重置，旧部署记录不能直接沿用。 |
| [Deployment Summary](https://docs.monad.xyz/developer-essentials/summary) | viem、Gas 与确认阶段 | 官方当前建议 viem >= 2.40.0；B 对真实 writer 做估算和回执检查，A 保存广播记录并在重启后查询，不盲目重发。 |
| [Transactions](https://docs.monad.xyz/developer-essentials/transactions) | Ethereum 兼容交易、chainId | EIP-1559 交易受支持；交易应显式携带 chainId。 |
| [MONSKILLS](https://skills.devnads.com/) | Monad 编码知识 | 按需只读 `monskill`、`scaffold`、`addresses`；没有安装整套 CLI、钱包或云服务。 |
| [Monad Developers 官方 GitHub](https://github.com/monad-developers) | 官方工具与教程入口 | 只读参考；没有认证、clone/fetch/push、fork 或复制比赛业务代码。 |
| [MOJO](https://mojo.devnads.com/) | 活动入口，已显示 2026-10-17 上海 Monad Blitz | 报名与提交由用户团队负责；应用中不接入。 |
| [contract.dev](https://contract.dev/) | 合约分析、监控和 Stagenet 模拟平台 | 首页未确认 Monad 支持或专项入口；等现场确认，不作为开发前提。其模拟记录不算 Monad 测试网真实上链。 |

## 公开网络检查

2026-10-17 本机发出只读 JSON-RPC 请求：

```json
{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}
```

- Endpoint：`https://testnet-rpc.monad.xyz`
- 实际响应：`{"jsonrpc":"2.0","id":1,"result":"0x279f"}`
- 十进制：10143，与项目预期测试网 ID 一致。
- 本机最初出现 DNS 错误；一次网络权限重试最终 RPC 成功，文档原文直连仍有 DNS 问题；网页阅读工具可读取文档。
- 此检查没有读取私钥、签名、发交易、部署合约或创建凭证。部署前仍必须再次 `eth_chainId` 并要求返回 10143。

网络配置：`chainId=10143`、原生币 `MON`、RPC 如上。测试网浏览器可采用 [Monadscan Testnet](https://testnet.monadscan.com/)；技能 `addresses` 明确区分主网/测试网浏览器。项目 `explorer_tx_base_url` 可以配置为 `https://testnet.monadscan.com/tx/`。`contract_address`、`deployment_block`、`issuer` 未拿到 B 的真实部署时为 null，不能从示例地址推断。

## 与 A/B 接口的关系

A：维持后端双厂商独立调用、共享哈希、持久化任务/广播/报告、SSE 与下载。A 通过 `@crosscheck/chain/server` 注入 B writer；广播回调立即落盘，确认超时保留 tx_hash，重启后用只读查询恢复。`demo` 报告明确标注，默认不调真实 writer。凭证读取要向已知部署读取、比对内容/报告哈希及 agreement，再返回已保存报告，不能把文件 proof 当链上事实。

B：负责真实合约、部署、writer 和只读入口。部署前核对 RPC 链 ID、issuer 和余额；通过 RPC 估算 Gas，等待成功 receipt，验证 receipt 来自部署配置中的合约且解析到正确事件。官方说明回执可早于 finalized；为 `confirmed` 选择并记录真实确认策略，不能将仅有交易哈希当成功。Monad 按 gas limit 收费，不能直接使用以太坊经验写死过大的 limit。来源：[部署摘要](https://docs.monad.xyz/developer-essentials/summary)。

交接真实 `deployment.json` 使用 `chainId`、`contract`、`abi`、`deploymentBlock`、`issuer`；API 公开字段仍为 snake_case，详见 chain-integration.md。A 不代填合约地址。赞助钱包私钥只来自后端运行环境，浏览器入口保持纯读取。

## 按需阅读的 Skill

- [monskill/SKILL.md](https://github.com/therealharpaljadeja/monskills/blob/main/skills/monskill/SKILL.md)：路由明确要求按任务取相关技能，不需全部加载。当前任务使用 scaffold 和地址验证部分。
- [scaffold/SKILL.md](https://github.com/therealharpaljadeja/monskills/blob/main/skills/scaffold/SKILL.md)：参考链下计算/链上承诺分离、TypeScript target >= ES2020 与部署后验证。用户明确保留现有 npm workspace、A/B 分工、当天业务代码从零编写和先本地开发，因此不采用该技能默认的新建 Git、Next.js/Para、Alchemy 钱包、先部署再开发和自动提交流程；这些不阻塞 A。未把其模板业务代码复制进项目。
- [addresses/SKILL.md](https://github.com/therealharpaljadeja/monskills/blob/main/skills/addresses/SKILL.md)：使用前校验网络和 `eth_getCode`，不编造地址、不混用主网地址。当前无 CrossCheck 部署地址可验证。

网络/性能数字若与技能旧说明冲突，以 Monad 当前官方文档为准，不从技能的 400ms/800ms 旧数字推断比赛现场实测。功能范围仍为免费双模型报告与测试网存证，不引入 x402、代币支付、账户或索引服务。

## 本轮事实边界

已完成：公开文档/技能参考核验、公开 RPC 的 chain ID 只读检查。

未完成/不属于本轮：B 的真实部署与 writer 联调、真实交易验收、contract.dev Monad 专项确认、MOJO 报名提交、远程 GitHub 提交推送。

WorkBuddy 后续从同一本地目录提交推送；保留现有 `.git`、分支与目录。禁止纳入真实 `.env`、API Key、钱包私钥、node_modules 和运行报告；仅提交 `.env.example` 与明确 demo fixture。
