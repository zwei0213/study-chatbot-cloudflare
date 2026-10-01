# 双条件 AI 对话实验

此项目基于 [Vercel Chatbot](https://github.com/vercel/chatbot)。被试通过两个独立链接进入实验：

- `/study/a`：共同规则 + 《模型要求》中的迎合条件规则
- `/study/b`：共同规则 + 《模型要求》中的相对独立判断条件规则

两个入口均在服务端调用同一个 DeepSeek 模型 `deepseek-flash`。提示词保存在服务端的 `lib/study/prompts.json`，浏览器请求不能选择模型或提交提示词。原始文档中的共同规则与两组条件规则已经转入该文件。

对话时长为 **10–30 分钟**：参与者阅读开始页说明并点击“开始对话”后计时，满 10 分钟才能点击“结束对话”，确认后保存结束时间并停止接收新消息。第 25 分钟显示收尾提醒，满 30 分钟再次提醒，但不会强制中断。计时按开始后的实际经过时间计算，刷新、切换标签页或暂时离开不会暂停或重置；服务端校验最短时长。

默认不限制对话轮数。若另行设置 `STUDY_MAX_EXCHANGES`，达到轮数后停止发送消息，但仍须满 10 分钟才能手动结束。以时长为准的实验建议不设置该变量。

本项目使用 Cloudflare D1（SQLite）保存会话。将旧版 PostgreSQL 数据库切换到 D1 不会自动复制历史记录；旧数据库不会被修改。

## 本地启动

需要 Node.js 22 和 pnpm。复制 `.env.example` 为 `.env.local`，至少配置：

```env
AUTH_SECRET=请填写随机长字符串
DEEPSEEK_API_KEY=请填写你的DeepSeekAPIKey
STUDY_ADMIN_TOKEN=请填写独立的随机长字符串
```

部署到 Cloudflare Workers 时，项目使用 Wrangler 中声明的 Worker Rate Limiting 绑定进行 IP 限流；本地开发不启用该限流。

然后执行：

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm db:migrate:local
corepack pnpm dev
```

打开 `http://localhost:3000/study/a` 和 `http://localhost:3000/study/b`。首次打开时项目会自动建立匿名访客身份，无需被试注册。一个浏览器身份在每个条件下对应一条持续会话；刷新页面会恢复聊天记录。正式实验应向每位被试只发其所属组的链接，并让不同被试使用各自的浏览器会话。

## Cloudflare Workers 部署

本目录是独立迁移副本，基于 OpenNext for Cloudflare。部署前准备 Cloudflare 账号、GitHub 私有仓库和 DeepSeek API Key。项目使用 D1 数据库 `study-chatbot-db`。Cloudflare Workers Builds 的构建命令应设置为 `pnpm install --frozen-lockfile`，部署命令设为 `pnpm run deploy`；部署脚本先应用 D1 迁移，再构建并发布 Worker。也可以在本地运行 `corepack pnpm deploy`，首次使用 Wrangler 时按提示登录 Cloudflare。

在 Worker 设置中配置以下 Secrets：`AUTH_SECRET`、`STUDY_ADMIN_TOKEN`、`DEEPSEEK_API_KEY`。`STUDY_ADMIN_TOKEN` 至少 32 个字符。不要将密钥提交到 GitHub。创建名为 `study-chatbot-db` 的 D1 数据库后，将 Cloudflare 给出的数据库 ID 填入 `wrangler.jsonc` 的 `d1_databases` 配置并提交。D1 本地开发由 Wrangler 自动创建持久化的 SQLite 文件，不需要数据库 URL。

首次部署后运行 `corepack pnpm db:migrate`，将 schema 应用到远程 D1。切换后新对话写入 D1；原 PostgreSQL 中的历史会话不会自动复制过来。D1 免费套餐有用量限制，正式开放前请按 Cloudflare 控制台显示的当前额度评估访问量。

部署后将 `/study/a` 与 `/study/b` 的 HTTPS 链接分别发给两组被试。DeepSeek API Key 和管理员令牌只能作为 Worker Secret 保存。

每次成功交互的用户消息和 AI 回复会成对写入 `StudyMessage`，并关联 `StudySession` 的会话 UUID、组别、模型、提示词快照和时间。CSV 还包含 `started_at`、`ended_at`、`duration_seconds`，其中时长仅在手动结束后填写；时间均为 UTC。使用管理员令牌下载 UTF-8 CSV：

```powershell
Invoke-WebRequest -Uri 'https://你的域名/api/study/export' -Headers @{ Authorization = 'Bearer 你的STUDY_ADMIN_TOKEN' } -OutFile 'study-conversations.csv'
```

导出接口不会向没有管理员令牌的请求提供数据。若模型请求失败，输入框会保留用户文字，且不会写入一段缺少 AI 回复的对话。部署前请用两个独立浏览器会话分别试聊、刷新和导出一次，确认两组记录及提示词配置符合实验方案。

### 管理后台

访问 `/admin` 并输入 `STUDY_ADMIN_TOKEN` 可查看参与者会话、按组别筛选和搜索用户/会话 UUID，也可检查对话全文。后台可以保存 DeepSeek API Key 的数据库覆盖值；它使用 AES-256-GCM 加密后存储，页面不会回显 Key。未设置后台覆盖值时，系统继续使用 `DEEPSEEK_API_KEY` Worker Secret。加密密钥由 `STUDY_ADMIN_TOKEN` 派生，因此更换该 Secret 后，需要在后台重新保存 API Key。部署前需运行 `pnpm db:migrate` 创建或升级设置表。
