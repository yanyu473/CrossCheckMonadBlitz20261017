# CrossCheck 对接契约

当前运行 `node --import tsx server.ts`，前端与API同源。所有私钥和模型Key留在服务器。`BACKEND_ORIGIN` 留空使用内置后端；填写后只转发 `/api`，前端静态页面仍由本机白名单提供。

## 公开配置

`GET /api/config`：`chainId, contractAddress, issuerAddress, deploymentBlock, rpcUrl, explorerUrl, publicOrigin, mode, chainMode, liveAvailable, backendMode`。

前端要求明确的预期链、合约和issuer，不能使用导入文件自己的地址作为信任锚。

## 任务

`POST /api/verify`：

```json
{"content":"原文字节保持不变","mode":"demo","scenario":"disagreement","request_id":"optional-unique-id"}
```

202返回 `{"job_id":"UUID"}`。demo场景为 `agreement | disagreement | unable`；真实模式 `live` 需要两家Key和明确model ID，否则503。相同request_id与相同内容只创建一个任务；内容改变返回409。

`GET /api/jobs/:job_id` 返回 `JobView`，定义在 `types.ts`。

`GET /api/jobs/latest` 返回最新 `JobView` 或null。

`GET /api/stream/:job_id` 使用SSE：`event: job` data为完整JobView；`event: delta` data为 `{slot,delta}`。晚连接先回放当前状态。终态关闭，前端有轮询兜底。

状态：queued → running → report_ready → anchoring → confirmed；可终止于failed/anchor_failed/interrupted。没有链写入配置时report_ready为可导出的最终报告，没有伪造proof。

## 报告

`GET /api/cert/:id`、`GET /api/reports/:job_id` 返回：

```json
{"report":{"payload":{},"proof":null},"hashes":{"content_hash":"0x...","verdict_hash":"0x..."}}
```

payload与proof完整类型在 `types.ts`，`proof` 只有收到成功交易回执、并验证指定合约事件后才产生。广播交易hash不会冒充已确认凭证；广播后服务中断不自动重试，需人工核对避免重复。

`computeHashes(payload)` 为后端权威协议实现：Keccak-256、精确UTF-8原文、递归规范JSON。models内部字段必须全部参与报告hash。`agreement`由结果派生；任一模型失败或无法判断时为2。

## 读写链

`createChainWriter({rpcUrl,privateKey,contractAddress,issuerAddress,chainId,chainMode})`。

调用 `anchor({job_id,content_hash,verdict_hash,agreement}, onBroadcast)` 返回 `ChainProof`。仅允许10143，或显式local模式的本机31337。模块校验issuer、字节码、receipt目标、事件地址/ID/双hash/状态，串行队列处理nonce。服务结束调用 `close()`。

优先 `readCertificateByTransaction(tx_hash,id,config)`；按ID扫描必须提供deploymentBlock，并有范围上限。`compareCertificate(envelope,record)` 比对完整proof和两个hash。

## 其他

`POST /rpc` 仅代理只读RPC，禁止发送交易；不替客户端提供写钱包。

`GET /api/qr?text=本项目页面URL` 本地生成PNG，只接受本服务或PUBLIC_ORIGIN的已知页面。

当前服务仅作为黑客松原型：尚无生产级账户、访问控制、隐私分级或持久对象存储；不要对外宣称生产合规服务。
