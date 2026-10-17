# CrossCheck 当前运行说明

更新日期：2026-10-17。

## 当前进度

- 四页前端、集成后端、持久报告、二维码和浏览器复核已接通。
- 已部署 Monad 测试网（10143）合约：`0x1aD4FFdE3c04b4C8daF208406957Db2dbFF45c8B`。
- 发证公开地址：`0xF6282e665b0a74b4cC1D9720a08c5CCcF2A22442`。
- [部署交易](https://testnet.monadscan.com/tx/0xe495b00564a8e3d8155194a369ce256103b08091712b03c01a7982de6ddaf337)。
- 浏览器已验证真实凭证，并验证修改嵌套模型理由会失败。390px 移动尺寸无横向溢出；尚未代替用户做实际手机联网测试。
- 26 项自动检查通过，包括真实本地 EVM 的权限、并发写入和收据验证。
- **真实模型 API 尚未配置。当前演示结果明确使用固定样例，不是真实 Claude / OpenAI 调用。**
- 已按 Mojo eventId=17 注册参赛 Agent；认领与参赛提交状态请以提交记录为准，不能把注册当成提交成功。

## 现在打开

本机入口：`http://localhost:5173/`。

目前已配置的同 Wi-Fi 入口：`http://YOUR_LAN_IP:5173/`。换网络后需把 `.env` 的 `PUBLIC_ORIGIN` 改为新的电脑局域网地址。不要向公网暴露 `.env` 或钱包文件；HTTP 服务仅开放明确的页面和 API 白名单。

如果服务已关闭：双击 **start-monad.bat**，使用现有 `.env` 和 Monad 测试网合约。若5173已被本项目占用，直接打开入口，不重复启动。

断网备用：关闭占用5173的本项目服务后，双击 **start.bat**，启动预设结果与本地 EVM 演示（链31337，页面明确标注不是 Monad）。本地数据保存在 `.local-demo/`，报告在 `data-local/`；真实测试网报告在 `data/reports/`，两者隔离。

不再使用原始 `auto-setup.bat` 复制覆盖桌面目录，或用静态 http-server 启动主项目。原始 Claude 输出仍保留在原路径。

## 现场演示

1. 提交页选“意见分歧”预设样例，点击提交。
2. 大屏显示两份预设结果，等待真正的 Monad 存证确认。
3. 打开报告，点击“从 RPC 核验当前报告”。浏览器直接读取交易回执，不凭后端返回的绿灯判断。
4. 下载报告，再导入该文件，应通过。
5. 点击“载入篡改样例（修改模型理由）”，再核验文本框，应提示完整报告指纹不匹配。

默认 `/rpc` 是本机只读代理；核验页面可改成官方 `https://testnet-rpc.monad.xyz`，从独立 RPC 读取。

## 接上真实模型

只在本机 `.env` 填写：

```env
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
OPENAI_API_KEY=
OPENAI_MODEL=
```

模型 ID 使用各自账户实际可调用的 API 标识；桌面聊天订阅不自动等同于 API 权限。重启 `start-monad.bat` 后，提交页才会启用真实 API 选项。密钥只在后端使用，不写进页面、截图、Git 或聊天。

调用失败、截断或无法解析时保留失败状态，不偷偷换预设结果。当前 API 使用整份结构化结果，SSE推送进度和完成结果，尚非模型 token 实时流。

## 与队友对接

目前内置后端可独立运行。队友可直接使用 `chain-writer.ts`、`chain-reader.ts`、`protocol.ts`、`types.ts` 和公开的 `deployment.json`。

队友后端完成后，设置 `BACKEND_ORIGIN=http://队友地址:端口`，当前服务继续托管前端并转发 `/api`。详细契约见 [BACKEND-INTEGRATION.md](BACKEND-INTEGRATION.md)。只分享 `.env.example`，不要分享 `.env`、`.secrets/` 或 `.local-demo/`。

## 检查与安装

Node.js 22及以上。已有环境可直接运行；新机器使用 `npm install`，或 `pnpm install --frozen-lockfile`。pnpm 11 的构建授权配置已经写入 `pnpm-workspace.yaml`。

```sh
npm test
npm run check
npm run compile
npm run preflight
```

只有 `deploy-monad.bat` 会发部署交易，脚本仅接受 Monad 测试网10143，并复用已经配置的合约。模型调用只有用户选择真实模式时触发。

## 证明边界

报告哈希固定的是原文字节、两份结果和报告元数据。它不证明内容真实、不证明模型调用确实发生、不代表模型厂商双签或合规认证。当前授权服务钱包负责发证；规范 JSON 递归排序对象键，数组保序，原文不静默去空白。

`showcase/` 是供公开发布的静态回放版：读取已经在 Monad 测试网锚定的预设报告，允许独立 RPC 核验。它没有实时模型调用或提交新报告的能力，不能当成完整后端托管。
