# CET-4 AI 阅读生成（React + TS + Node 代理）

从词库勾选目标词，调用 DeepSeek（Kimi / Qwen / GLM / OpenAI 为可选）生成「仔细阅读」或「段落匹配」，
经过「模型自检 + 代码校验」两层把关，结果先进入待发布队列，管理员审核后才算入库。

## 功能（对齐旧版 ETC4）

| 标签 | 内容 |
|---|---|
| 阅读练习 | 内置 4 篇段落匹配（10 段 × 10 句）+ 4 篇仔细阅读（5 题四选一），交卷打分；点文中任意单词弹出音标/释义，可一键加入单词本 |
| 单词本 | 学习（抽 10 词四选一，揭晓后「斩 / 不认识」，不会的排到本轮末尾）、复习（1/2/4/7/15 天间隔）、词库（输入单词自动查词典、批量导入、斩/恢复/删除/标弱）、统计（已斩、到期、连续打卡、28 天日历） |
| 导入题目 | 粘贴 `#题目 … #结束` 文本，解析预览、逐题删除、确认导入；错误带「第 X 个题目 第 Y 行」 |
| 待发布 | AI 生成结果的审核队列：查看、发布、删除 |
| 进度 | 练习次数、答题数、正确率、最近记录 |
| 设置 | Provider Key 管理（掩码显示、测试连接、清除） |

数据都在浏览器 localStorage：`reading-ai.wordbook.v1`（单词本）、`reading-ai.imported.v1`（导入题目）、`reading-ai.sessions.v1`（练习记录）；旧的 `reading-ai.library` 会自动迁移进单词本。

## 双击启动（已打包 exe）

`D:\ETC4\CET-4 AI 阅读生成.exe`（8.4 MB，单文件启动器）

- 双击后：选端口（固定优先 **8799**，被占用则顺延）→ 启动本地 Node 服务 → 用 Edge `--app` 开一个无地址栏窗口；
- 关闭窗口 → 启动器自动停掉服务，不留后台进程；
- 浏览器数据存在 `data/browser/`（词库等 localStorage 跟着它走），Key 在 `data/providers.json`，缓存/队列在 `data/cache.db`；
- 会话密钥持久化在 `data/session.key`，重启后不用重新申请会话。

命令行：

```bash
"CET-4 AI 阅读生成.exe" --selftest    # 只启动服务并检查 /api/providers，退出码 0 表示正常
"CET-4 AI 阅读生成.exe" --no-window   # 只启动服务，打印地址
```

**它依赖同目录的这些文件**，不能只拷 exe：

```
dist/                前端构建产物（vite build）
dist-server/         服务端编译产物（tsc -p tsconfig.server.json）
node_modules/        运行期只有 better-sqlite3 是必需的；缺了会降级 memory
runtime/node.exe     Node 20 运行时（缺失则用系统 PATH 里的 node）
data/                Key、缓存、队列、浏览器 profile（首次启动自动创建）
```

重新打包：

```bash
npm run build:all
python -m PyInstaller --onefile --noconsole --name "CET-4 AI 阅读生成" --distpath . --workpath build-launcher --specpath build-launcher tools/launcher.py
```

## 快速开始

```bash
npm install
cp .env.example .env        # 至少填一个 *_API_KEY
npm run dev:server          # http://127.0.0.1:8787
npm run dev:web             # http://127.0.0.1:5173 （/api 已代理到 8787）
npm test                    # 25 个单测
```

不配 Key 也能启动：`/api/providers` 返回空数组，前端「阅读生成」入口整体隐藏，其余功能不受影响。

## 结构

```
shared/types.ts                  前后端共用类型
server/index.ts                  HTTP 入口（providers / session / generate / queue）
server/api/generate-reading.ts   编排：鉴权 → 参数 → 缓存 → 限流 → 生成 → 校验 → 入队
server/llm/provider.ts           Provider 适配（json_schema / json_object 两路）
server/llm/prompts.ts            System prompt + JSON Schema + PROMPT_VERSION
server/llm/validate.ts           10 条硬校验（纯函数）
server/llm/cache.ts              缓存键与 TTL（仔细阅读 7 天 / 段落匹配 14 天）
server/lib/store.ts              sqlite / memory（redis 预留）统一存储
server/lib/rate-limit.ts         客户端/IP 日限 + 最小间隔 + token 统计
server/lib/session.ts            浏览器短期会话令牌（HMAC）
src/features/reading-ai/…        React 组件、hook、API 客户端
tests/                           vitest 单测
```

## 校验口径（与 prompt 对齐）

| 项 | 仔细阅读 | 段落匹配 |
|---|---|---|
| 字数 | 350–450（prompt 目标 380–420） | 800–1050（prompt 目标 850–1000） |
| 段落 | ≥4 | 11–13（10 句匹配 + 2–3 干扰段） |
| 目标词 | 输入词 100% 使用，命中率 ≥80% | 同 |
| evidence | 必须是所在段落原文的逐字子串 | 同 |
| 正确项改写 | 与 evidence 连续重合实词 ≤3 | 待匹配句同理 |
| 干扰项 | 四类 ①②③④ 必须齐全 | — |
| 词义题 | testedWord ∈ 目标词，且不在高中基础词白名单 | — |

「每段必须有转折」「长难句 ≥2」「禁止说教口吻」「目标词密度 8%–15%」「单目标词 ≤2 次」都是 **warning**，不阻断入库。

## Key 管理：完全在应用里改

默认形态是 **Key 只存在服务端设置文件里**，` .env ` 不再需要放密钥。

- 打开应用右上角「设置」→ 选 provider → 填 Key（可改模型/Base URL）→ 保存 → 立即生效；
- 「测试连接」发一次最小请求，返回延迟或错误；
- 「清除」移除该 provider 的 Key；
- 落盘位置 `data/providers.json`（已加入 `.gitignore`），前端任何响应只看到掩码 `sk-b9b…469f`。

优先级与回退：

1. **设置页保存的 Key > 环境变量**；清掉设置页 Key 后会回落到 `.env`（如果那里仍配了）；
2. 两个都没有 → `/api/providers` 为空，生成入口隐藏，不报错；
3. 迁移/备份：把 `data/providers.json` 复制到新机器即可带走配置（文件是明文，注意权限）。

`.env` 现在只放非敏感配置（端口、缓存驱动、限流、模型名）。服务启动时会自动读取它（内置极简解析，无依赖），已存在的环境变量优先。

## 接口## 接口

- `POST /api/session {clientId}` → `{token, expiresAt}`
- `GET/POST /api/settings`、`DELETE /api/settings/:provider`、`POST /api/settings/test` → 设置页（需令牌）
- `GET /api/providers` → 可用 provider、cache 驱动、promptVersion、限流配置
- `POST /api/generate-reading` → 需要 `Authorization: Bearer <session>` + `X-Client-Id`
- `GET/POST /api/settings`、`DELETE /api/settings/:provider`、`POST /api/settings/test` → 设置页用（同样要令牌）
- `GET /api/queue`、`POST /api/queue/:id/publish`、`DELETE /api/queue/:id`

响应头：`RateLimit-Limit/Remaining/Reset`、`X-Provider`、`X-Cache: HIT|MISS`。

## 真实调用验收（DeepSeek，2026-11-17）

配置 `DEEPSEEK_API_KEY` 后，按最终版提示词各跑一次：

| 用例 | 结果 |
|---|---|
| 仔细阅读，8 个目标词，CET4 | **HTTP 200，attempt=1**，384 词 / 5 段，目标词 8/8（100%），最大连续重合 2 词，0 错误 |
| 段落匹配，10 个目标词，CET4 | **HTTP 200，attempt=1**，834 词 / 13 段，10 句答案 C–M 不重复，未匹配 3 段，命中率 100% |
| 相同参数第二次请求 | `X-Cache: HIT`，不再调用模型；队列只入 1 条 |

调试过程中被拒绝的真实输出（留作回归样本）：

1. 模型自己编了 `dismiss / cultivate / erode` 等词，8 个目标词只用了 1 个 → 命中率 13% 被拒；
2. 正确项逐字照抄原文 9 个实词 → 重合上限 3 被拒；
3. 词义题考 `sustain`（高中本义）→ 基础词黑名单被拒；
4. 段落匹配重复用 A/B 段、9 段空着 → 每段最多一次 + 干扰段 2–3 被拒；
5. 正文 334 词 → 字数下限 350 被拒。

据此做了四处提示词工程（不是放宽校验）：

- `json_object` 模式由「塞完整 JSON Schema」改成「塞紧凑输出示例」，system prompt 从 ~2k tokens 降到 ~700，遵守率明显提升；
- 目标词清单直接写进 system prompt，并在末尾再强调一次；
- 词义题只允许从「非基础词」候选里选，候选取自 `BASIC_WORDS` 之外的输入词；
- 仔细阅读词数目标提到 400–440（校验仍是 350–450），避免压线。

说明：真实输出仍有波动（同样的参数不同次运行，首轮成功率不是 100%），这也是保留「反馈重试 + 422 不入库」的原因。

## 目前的边界

- **真实模型调用未验证**：仓库里没有 Key，10 条校验、缓存、限流、队列、鉴权都是可测的确定性逻辑，只有真正的上游请求需要你配 Key 后跑一次。
- 段落匹配 12–13 段是刻意偏离「8–10 段」的：10 个句子 + 每段最多一次 + 2–3 个干扰段，三者数学上无法在 10 段内同时成立。
- `distractorNotes` 用数组而不是对象键，因为 `strict: true` 的 JSON Schema 不允许动态键。
- Redis 驱动只留了接口与降级，未实现真实连接。
