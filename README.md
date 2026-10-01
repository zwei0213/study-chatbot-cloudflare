# AI 对话实验平台

为参与者提供 A、B 两种实验条件的 AI 对话，并提供后台管理会话记录和 API Key。

## 参与者使用

选择研究人员提供的对应链接进入实验：

- A 组：[study.489646.xyz/study/a](https://study.489646.xyz/study/a)
- B 组：[study.489646.xyz/study/b](https://study.489646.xyz/study/b)

阅读页面说明后点击“开始对话”，即可与 AI 交流。对话至少持续 10 分钟；第 25 分钟和 30 分钟会收到提醒。达到 10 分钟后可手动结束。

## 管理员使用

访问 [study.489646.xyz/admin](https://study.489646.xyz/admin)，输入 Cloudflare Worker Secret `STUDY_ADMIN_TOKEN` 登录。后台可查看、搜索和筛选会话，查看对话内容、删除会话，以及设置或清除 DeepSeek API Key。
