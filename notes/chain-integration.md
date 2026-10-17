# B 链模块交接

`packages/chain` 已实现 A/B 协议适配，复用 B 已验证的事件解析器。仓库保留 B 已有的 Monad 测试网部署资料与历史验证报告；本次新增适配仅用隔离 EVM 验收，未另发公网交易。server 与 browser 分开导出，browser 不导入私钥、Node 依赖或服务器入口，也不填写虚构地址。

## 配置契约

B 的部署文件由后端根目录 `DEPLOYMENT_FILE` 指定，默认 `deployment.json`：

```ts
type Deployment = {
  chainId: 10143;
  contract: string; // 真实部署地址，也兼容 contractAddress
  abi: unknown[];
  deploymentBlock: string; // 十进制整数
  issuer: string; // 真实应用 issuer
};
```

不要用全零或示例地址代替缺失配置。部署前向 RPC 查询 chain ID，必须等于 10143，再检查合约 bytecode、issuer 与链上部署区块。采用 Monad 当前官方部署建议；详情见 development-resources.md。

`createChainWriter` 接收 `{rpc_url, private_key, deployment, public_config}`；private_key 只从服务器 `ISSUER_PRIVATE_KEY` 读取。返回：

```ts
{
  configured: boolean;
  anchor(input: AnchorInput,
         onBroadcast: (tx_hash: string) => Promise<void>): Promise<ChainProof>;
  recover?(tx_hash: string, input: AnchorInput): Promise<CertificateRecord | null>;
}
```

`configured=true` 是 B 模块明确表明实现/初始化就绪；A 还要求 `CHAIN_ENABLED=true`、部署与私钥存在才调用。A 的 demo 无论配置如何都不广播。

writer 广播后必须立即 `await onBroadcast(tx_hash)`，才能进入等待回执阶段。确认超时抛 `{code:'CONFIRMATION_TIMEOUT', tx_hash}`。失败不能吞掉 tx_hash；不得悄悄重发。A 把 attempted_at 在调用前落盘，tx_hash 在回调时落盘。

`recover` 是基础协议的兼容可选扩展：仅按持久化交易查回执和正确合约事件，校验 hash/agreement，再返回 CertificateRecord；未确认返回 null，已回滚用明确错误。无需已知 certificate_id，由事件解析得到。这解决仅有 tx_hash、还没获得 id 的重启恢复场景。未实现时 `chain_recovery_ready=false`，A 保留待确认状态，不自动重发。

`@crosscheck/chain/browser`：

```ts
readCertificate(id, publicConfig): Promise<CertificateRecord>
readCertificateByTransaction(tx_hash, id, publicConfig): Promise<CertificateRecord>
```

publicConfig 为公开协议字段，A 服务器另传 `rpc_url` 与 `abi`。reader 必须读取已知配置中的合约，不能按导入文件的任意地址查询后就认可。找不到抛 `CERTIFICATE_NOT_FOUND`；RPC 不可用抛 `CHAIN_UNAVAILABLE`，不能用本地 proof 兜底。

## A 已执行的防护

A 对 writer 调用排队，记录交易，等待真实 reader 返回的哈希、agreement、chain_id、contract、issuer、certificate_id 与 tx_hash 匹配才标记 confirmed。`GET /api/cert` 每次重新读链。合约事件必须由 B 校验来源、成功 receipt 与确认策略；不能只返回交易哈希就声称成功。

确认超时后同文同配置的重复 POST 返回原任务，保护未知广播结果。该保护与普通报告缓存不同，不因缓存 TTL 到期解除。没有 tx_hash 且 attempted_at 已有值的重启任务标记 `BROADCAST_OUTCOME_UNKNOWN`，需要人工核对钱包/nonce；不要删数据重试。明确已回滚才允许新任务重试。

A 的 mock 回归覆盖成功、回滚、错链、错合约、错 issuer、错 hash、重启恢复；新增链包真实隔离 EVM 用例与 A 服务跨模块集成用例。后者验证真实编译部署、Gateway 写入与恢复、HTTP 证书与下载、重启后重新读链。这些测试记录不属于公网交易，不能作为比赛凭证。

## 集成验收待 B 到位

1. 保留 B 已有免费 issuer-only `certify(bytes32,bytes32,uint8)` 合约、测试网部署与历史验证资料；运行机可按既有地址重新复核。
2. B 把网页 `/api` 代理到 A 的 IP:3001，使用共享协议包和示例事件。
3. 最终运行机本地配置模型 Key/ID、私钥和部署文件；不要经 Git 或聊天传秘密。
4. 真实双模型 → 链确认 → 三页面 → 下载 → 改 payload 后不匹配 → 只改 JSON 排版仍匹配。
5. 断网必须显示核对不可用，demo 与真实链凭证分开；保留实际 tx hash 与可查浏览器链接。

本轮不执行公开网络合约部署、MOJO 提交或 contract.dev 模拟。

## 集成实现与本地验收

- 公共接口保留 snake_case，类型与结构验证来自 `@crosscheck/protocol`；不改 A schema。
- `configured=true` 表示部署、ABI、公开配置与本地签名钱包通过结构检查；实际 RPC 链 ID、部署区块代码和当前授权 issuer 在写入前核验。
- 默认仅允许 Monad 测试链 10143。测试代码可显式传 `chainMode:'local'` 使用本机 HTTP(S) RPC 与链 31337；31337 或其他链号不会因部署文件声称可用而自动放行。此开关不改变 A 服务端默认 10143 的配置限制。
- 默认等待 1 个确认；可传 `confirmations`（1–100）与 `confirmation_timeout_ms`（默认 30000）。超时携带 `CONFIRMATION_TIMEOUT` 和已广播 `tx_hash`；队列不会自动重发。同一 issuer 钱包应只由一个 writer 实例负责广播。
- `recover(tx_hash,input)` 不要求已知凭证 ID，只读取该交易；未知或确认不足返回 null，已回滚抛 `TRANSACTION_REVERTED`，输入、固定目标或 issuer 不符抛 `RECORD_MISMATCH`。
- 读写同时核验收据成功、交易目标/发起者、实际 chain ID、免费 `certify` 调用参数、固定合约发出的唯一事件、双哈希、agreement、区块哈希与事件时间。`block_time` 为 Unix 秒十进制字符串。
- 浏览器 reader 可通过 `tx_hash` 直接查询，未提供时从固定部署区块分段查询，最大 100000 区块；超出时必须提供交易哈希。导入 JSON 的合约地址不能替代已知配置。
- A 内部 Gateway 支持 `read(id, tx_hash?)`：确认阶段与有已存 proof 的证书请求直接使用已知交易哈希，重启后也不依赖内存索引扫描历史。每次仍重新读收据、核验全部字段，网络故障不会返回本地 proof 作为已核验结果。
- writer 提供 `close()`；A 服务关闭时仅一次转发 Gateway 的清理方法，释放 provider。清理不会自动重发未确认交易。
- `packages/chain/test/evm.test.ts` 使用独立随机钱包与随机本机端口，真实编译部署 Solidity，仅验证本地 EVM 行为；不读取 `.env`、不接触已有钱包、不表示已获得 Monad 网络凭证。
- `tests/integration-chain.test.ts` 进一步使用隔离 EVM 的链号 10143，以 A 原有配置规则执行 HTTP → 服务 → Gateway → 真实合约 → 凭证下载 → 服务重启；模型为明确标识的 test-only 适配器，不请求真实模型 API。删除测试链事件后，本地已保存 confirmed 报告也不能通过证书路由复核。
