# AI 对话实验平台

一个用于对照实验的 AI 聊天网站，使用 Cloudflare Workers 部署，并用 D1 保存会话。

## 功能

- `/study/a` 和 `/study/b`：两种实验条件下的流式 AI 对话。
- `/admin`：查看、删除会话记录，并设置 DeepSeek API Key。
- `lib/study/prompts.json`：配置两组实验提示词。

## 部署到 Cloudflare Workers

项目使用 Next.js、OpenNext、Cloudflare Workers Builds 和 D1。首次部署前，先准备自己的 Cloudflare 资源；不要沿用仓库当前 `wrangler.jsonc` 中示例项目的数据库 ID。

### 1. Fork 仓库并创建 D1

1. 在 GitHub Fork 本仓库到自己的账号。
2. 登录 Cloudflare，进入 **Workers & Pages → D1 SQL Database**，创建一个新的数据库，例如 `study-chatbot-db`。
3. 记下新数据库的 UUID，在 Fork 仓库中编辑 `wrangler.jsonc` 的 D1 配置：
   - `database_name`：填写刚创建的数据库名称。
   - `database_id`：替换为刚记下的 UUID。
   - `binding` 保持为 `DB`，`migrations_dir` 保持为 `migrations`。
4. 确认 `wrangler.jsonc` 中 Worker 的 `name` 在你的 Cloudflare 账号内没有被其他 Worker 使用。若修改 `name`，也要把 `WORKER_SELF_REFERENCE` 下的 `service` 改成相同名称。
5. 为 `CHAT_RATE_LIMITER` 和 `ADMIN_RATE_LIMITER` 设置在你账号内未被其他 Worker 使用的正整数 `namespace_id`。同一账号中重复使用 namespace ID 会共享限流计数。

### 2. 连接 GitHub 并设置构建

在 Cloudflare 的 **Workers & Pages** 中创建 Worker，选择从 GitHub 导入 Fork 的仓库，并连接你的 GitHub 账号。构建设置如下：

- 根目录：仓库根目录（通常保持默认值）。
- 生产分支：`main`。
- 构建命令：

  ```sh
  pnpm exec wrangler d1 migrations apply study-chatbot-db --remote && pnpm exec opennextjs-cloudflare build
  ```

- 部署命令：

  ```sh
  npx wrangler deploy
  ```

构建命令会将 `migrations/` 中尚未执行的 SQL 迁移应用到你自己的远程 D1，再构建应用。构建部署所用的 Cloudflare API Token 需要 **Workers Scripts: Edit** 和 **D1: Edit** 权限。若自动生成的 Token 没有 D1 权限，请在构建设置中改用具有这些权限的 Token，否则数据库迁移会失败。

### 3. 设置 Worker Secrets

部署后，在 Worker 的 **Settings → Variables and Secrets** 添加以下 Secrets：

| 名称 | 用途 |
| --- | --- |
| `AUTH_SECRET` | NextAuth 会话加密密钥；使用随机生成的长密钥。 |
| `STUDY_ADMIN_TOKEN` | `/admin` 管理员登录密钥，至少 32 个字符。 |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥。也可以部署后登录 `/admin` 设置 API Key，此项就可以不配置。 |

不要把真实密钥写进代码、提交到 GitHub，或填入公开的 `wrangler.jsonc`。配置完 Secrets 后，如 Worker 尚未使用新配置，重新部署一次。

首次部署成功后，打开 `https://你的Worker域名/admin`，使用 `STUDY_ADMIN_TOKEN` 登录；若没有配置 `DEEPSEEK_API_KEY` 环境变量，可在管理界面保存 DeepSeek API Key。将 API Key 存到管理界面后，请保持 `STUDY_ADMIN_TOKEN` 不变；更换该 Token 后，需重新保存 API Key。

### 4. 绑定自己的域名（可选）

确认 Worker 已能通过 `workers.dev` 地址访问后，在 Worker 的 **Settings → Domains & Routes** 添加自定义域名。域名需要已添加到当前 Cloudflare 账号，并处于可用状态。

### 5. 后续更新

将修改推送到 GitHub 的 `main` 分支，Cloudflare Workers Builds 会自动构建并部署。每次构建都会先应用新的 D1 迁移，再生成 Worker。

## 本地开发

需要 Node.js 和 pnpm。复制 `.dev.vars.example` 为 `.dev.vars`，填入本地使用的密钥，然后运行：

```sh
pnpm install
pnpm exec wrangler d1 migrations apply study-chatbot-db --local
pnpm dev
```

本地 D1 数据保存在 Wrangler 的本地开发数据目录中，与 Cloudflare 线上 D1 相互独立。`.dev.vars` 不要提交到仓库。
