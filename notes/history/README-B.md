# CrossCheck — 双模型报告与链上证据

Monad Blitz 原型。完整 Node 产品提供提交、双模型适配器、持久报告与授权存证；showcase/ 提供无需后端的公开回放与浏览器直读 RPC 核验。

## 运行

Node.js 22+，npm install，然后 npm start。新环境复制 .env.example 为 .env 并填写自己的配置。离线本地 EVM 演示使用 npm run demo。已有 Monad 测试网合约的公开信息在 deployment.json。

## 实际状态

- 已部署 Monad 测试网10143，并生成可复查凭证。
- 26项自动检查通过，浏览器完整提交/报告导出导入/真实RPC验证/篡改失败已验收。
- 当前公开演示使用预设模型样例，链上交易真实。
- 真实 OpenAI/Anthropic API 适配器已实现，但尚未配置Key和实测，不能宣称真实双模型审核已跑通。
- 完整 Node 服务目前本地运行；showcase 是已存证样例的静态回放，不接受任意内容进行实时审核。

## 证明边界

指纹匹配只证明报告与指定合约记录相符。它不证明内容正确、真实模型调用发生或模型厂商签名。测试网结算不是真实收入。

详见 RUN-NOW.md 与 BACKEND-INTEGRATION.md。测试使用 npm test，类型检查使用 npm run check。

## 公开演示

已发布并经浏览器核验：https://yanyu473.github.io/CrossCheckMonadBlitz20261017/

指定主仓库的实现PR：https://github.com/LINXIAO-LI2025/CrossCheckMonadBlitz20261017/pull/1 （待仓库所有者合并）。
