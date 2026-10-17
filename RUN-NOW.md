# 当前运行说明

默认入口已接入 A 后端：执行 npm ci、npm run check、npm start，打开 http://localhost:3001 。Windows 可双击 start.bat；无需 npm 的本机运行脚本见 scripts/local.ps1。

- MODE=demo：固定结果，proof=null，永不广播。选择样例会在输入中明确写入前缀。
- MODE=live：两个审阅模型会**同时**发起请求（同一个上游地址 + 同一个密钥，只有模型 ID 不同）。可先用 `npm run probe -- "要审阅的原文"` 验证通道，答案会同时写到 `data/model-outputs/`。失败不会回退到 demo。
- 思考档与超时要分开配：不同模型接受的最低档不同（有的在 `minimal` 下会挂死，有的显式传档直接 400），用 `MODEL_A_REASONING_EFFORT` / `MODEL_B_REASONING_EFFORT` 分别指定；中转不流式返回时，把 `MODEL_REQUEST_TIMEOUT_MS` 调高（默认 20s），否则需要思考的命题会被误判超时。
- 每个任务的完整报告（含两份模型判断与理由）落在 `data/<job_id>.json`；`data/model-outputs/` 只存 probe 的问答记录。
- 实际存证另需 CHAIN_ENABLED=true、ISSUER_PRIVATE_KEY 和 deployment.json。浏览器没有私钥，只读 RPC。
- 手机使用同 Wi-Fi 下的电脑IP:3001，服务设 HOST=0.0.0.0；PUBLIC_ORIGIN 可填局域网入口。浏览器模拟尺寸检查不代表真实手机联网已验证。

页面支持提交、任务大屏、完整 JSON 导出/导入、离线指纹复算及链上核验。没有 proof 的报告只能离线比较，不显示链上成功。

公开 deployment.json 保留已部署的 Monad 测试网10143合约 0x1aD4FFdE3c04b4C8daF208406957Db2dbFF45c8B。docs/和showcase/保留三条真实调用产物的存证报告（凭证 #10–#12），可独立核对；A当前demo不会新增交易。

B 原实现保留在 server.ts / server/，用 npm run start:legacy 单独运行；其本地EVM样例是 npm run demo:legacy。旧运行说明保存在 notes/history，当前接口以 notes/interface-contract.md 为准。不要同时让两个服务使用同一数据目录或端口。

本次对接验证详见 INTEGRATION.md。真实模型通道已于 2026-10-17 实测跑通：三条公开样例即当次调用产物（A槽 gpt-6-sol、B槽 claude-opus-5-5，同一上游网关并行），凭证 #10–#12 已上链。
