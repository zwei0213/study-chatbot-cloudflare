# AI 对话实验平台

## 代码简介

- 基于 Next.js，使用 OpenNext 适配 Cloudflare Workers。
- `/study/a` 和 `/study/b` 提供两种实验条件的流式 AI 对话。
- `lib/study/prompts.json` 保存服务端系统提示词。
- Cloudflare D1 与 Drizzle ORM 保存会话记录；`/admin` 提供会话管理和 API Key 设置。

## Cloudflare 部署

项目通过 Cloudflare Workers Builds 从 GitHub `main` 分支构建和部署。连接仓库 `zwei0213/study-chatbot-cloudflare` 后，设置：

- 根目录：`/`
- 构建命令：

  ```sh
  pnpm exec wrangler d1 migrations apply study-chatbot-db --remote && pnpm exec opennextjs-cloudflare build
  ```

- 部署命令：`npx wrangler deploy`

在 Worker 的“设置 → 运行时变量和密钥”中添加以下 Secrets：

- `AUTH_SECRET`
- `DEEPSEEK_API_KEY`
- `STUDY_ADMIN_TOKEN`

`wrangler.jsonc` 配置 Worker、D1 数据库和速率限制绑定。推送到 `main` 后，Cloudflare 会按构建配置自动部署。
