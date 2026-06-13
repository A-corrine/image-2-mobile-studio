# Image 2 Studio

一个移动端优先的生图产品原型，前端只访问本地服务端，`OPENAI_API_KEY` 保留在服务端环境变量中。

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

## Vercel 部署

项目已包含 Vercel serverless API：

- `api/config.js`
- `api/health.js`
- `api/generate.js`

部署后需要在 Vercel Project Settings -> Environment Variables 中设置：

```text
OPENAI_API_KEY=你的 OpenAI API Key
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
OPENAI_IMAGE_MODEL=gpt-image-2
```

如果用 Web Service 手动创建，保持 Start Command 为：

```text
npm start
```
