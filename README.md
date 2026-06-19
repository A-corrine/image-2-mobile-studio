# Image 2 Studio

一个移动端优先的生图产品原型，前端只访问本地服务端，`OPENAI_API_KEY` 保留在服务端环境变量中。

正式收款前逐项完成 [`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md)。

## 上传到 GitHub

推荐安装 Git 后通过版本控制提交。如果当前电脑没有 Git，也可以在 PowerShell 运行：

```powershell
.\push-to-github.ps1
```

脚本会要求输入仅授权本仓库 `Contents: Read and write` 的 Fine-grained Token，并通过 GitHub Git Data API 把当前项目合并成一次提交。Token 只保存在当前 PowerShell 进程内，不会写入项目；上传完成后应立即在 GitHub 撤销。

## 运行

1. 复制 `.env.example` 为 `.env`，填入 `OPENAI_API_KEY`。
2. 如需切换模型，修改 `OPENAI_IMAGE_MODEL`。当前按需求默认使用 `gpt-image-2`；如果账号暂未开放该模型，可改为官方文档列出的 `gpt-image-1.5`。
3. 在 PowerShell 中运行：

```powershell
.\start.ps1
```

然后打开 `http://localhost:3000`。

## 主要功能

- 移动端生图工作台
- 提示词输入、快速题材、风格、画幅、质量、格式
- OpenAI Images API 服务端代理
- 生成结果预览、下载、分享、复制提示词
- 最近作品缩略历史
- 浏览器匿名账户与试用点数
- 服务端扣点、失败自动退点
- Stripe Checkout 点数包购买
- Stripe webhook 幂等到账
- 邮箱验证码登录与跨设备余额恢复
- 退款事件同步扣回点数
- 密码保护的运营与订单概览

## Vercel 部署

项目已包含 Vercel serverless API：

- `api/config.js`
- `api/health.js`
- `api/generate.js`

部署后需要在 Vercel Project Settings -> Environment Variables 中设置：

```text
OPENAI_API_KEY=你的 OpenAI API Key
OPENAI_BASE_URL=https://openclaw-api.com
OPENAI_IMAGE_MODEL=gpt-image-2
```

也可以用 CLI 设置：

```powershell
vercel env add OPENAI_API_KEY production
vercel env add OPENAI_IMAGE_MODEL production
vercel deploy --prod
```

## Render 部署

这个项目也可以直接作为 Render Web Service 部署。仓库里已经包含 `render.yaml`：

- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`

部署步骤：

1. 把项目推到 GitHub 仓库。
2. 在 Render 新建 Blueprint 或 Web Service，连接这个仓库。
3. 设置环境变量：

```text
OPENAI_API_KEY=你的 OpenAI API Key
OPENAI_BASE_URL=https://openclaw-api.com
OPENAI_IMAGE_MODEL=gpt-image-2
```

如果用 Web Service 手动创建，保持 Start Command 为：

```text
npm start
```

## 付费功能配置

应用默认给新账户 3 点，每次成功发起一次图片生成消耗 1 点。支付和余额都在服务端处理，前端不能自行修改点数。

Render 还需要以下环境变量：

```text
APP_SECRET=至少32位的随机字符串
DATABASE_PATH=./data/app.db
STARTER_CREDITS=3
STRIPE_SECRET_KEY=Stripe 后台的 sk_test_ 或 sk_live_ 密钥
STRIPE_WEBHOOK_SECRET=Stripe webhook 的 whsec_ 密钥
BILLING_ENABLED=false
RESEND_API_KEY=Resend 后台的 re_ 密钥
EMAIL_FROM=Image 2 Studio <login@你的已验证域名>
BUSINESS_NAME=对外展示的产品或经营者名称
SUPPORT_EMAIL=真实客服邮箱
ADMIN_PASSWORD=至少16位的独立随机密码
```

在 Stripe Workbench -> Webhooks 中添加生产环境回调地址：

```text
https://你的域名/api/stripe/webhook
```

订阅 `checkout.session.completed` 和 `charge.refunded` 事件。前者负责支付到账，后者负责退款后幂等扣回对应点数。测试完成后再把测试密钥切换为生产密钥。

`BILLING_ENABLED` 默认必须保持 `false`。只有在持久磁盘、生产 Webhook、退款政策和真实小额订单都验证完成后，才改为 `true` 开始收款。

### 生产数据持久化

Render 免费实例的本地文件会在重新部署或重启后丢失，只能用于功能测试。正式收费前必须升级 Render 实例并挂载 Persistent Disk：

```text
Mount path: /opt/render/project/src/data
Size: 1 GB
```

挂载后继续使用 `DATABASE_PATH=./data/app.db`。没有持久磁盘时，不要正式收款。

当前点数包在 `server.js` 的 `creditPacks` 中配置。修改售价时，必须同时保留服务端对金额、币种和点数的校验。

### 邮箱登录

应用通过 Resend 发送 6 位验证码。先在 Resend 验证发信域名，再把 `RESEND_API_KEY` 和 `EMAIL_FROM` 填入 Render。验证码 10 分钟有效，同一来源 15 分钟最多发送 3 次，连续输错 5 次后失效。

购买接口要求账户先验证邮箱。用户在新设备使用同一邮箱登录时，匿名账户中的剩余点数会合并到邮箱账户，已购买余额不会被锁在原浏览器中。

### 运营后台

配置 `ADMIN_PASSWORD` 后访问 `/admin.html`。用户名固定为 `admin`，密码只保留在当前页面内存，刷新页面后需要重新输入。后台显示账户、点数、生成请求、退款后收入和最近订单；连续输错 10 次会暂时限流。
