# codex-mimo-skill

> Codex 写代码，MiMo 管文案、审美和内部前端首版。

`codex-mimo-skill` 是一个给 Codex 用的 MiMo v2.5 Pro CLI + Skill。它不改 Codex 配置，不做代理，不碰 Reasonix；只把适合 MiMo 的任务拆出来：中文文案、命名、真人反馈、UI/UX、视觉 brief、中文 UI review，以及 G2 内部 admin / ERP / dashboard 的 frontend first-pass。

```text
Codex decides -> codex-mimo calls MiMo -> copy / brief / first-pass -> Codex applies and verifies
```

## 为什么单独做

MiMo 和 DeepSeek 适合放在不同 harness 里：

| 模型 | 最适合的位置 | 负责什么 |
|---|---|---|
| MiMo v2.5 Pro | Codex 直接调用 | 文案、中文表达、UI/UX、内部前端首版 |
| DeepSeek v4 Pro | Reasonix / Ollama Cloud | 工程 review、二意见、最终判断 |

这也是为什么 MiMo 从 `codex-reasonix-bridge` 里拆出来。`codex-reasonix-bridge` 继续保留 Reasonix / DeepSeek 的 review 角色；这个仓库只做 MiMo。

## 和 mimo2codex 的关系

这个项目参考了 [7as0nch/mimo2codex](https://github.com/7as0nch/mimo2codex) 的方向：让新版 Codex 能更顺地使用 MiMo 等模型。

但两者边界不同：

| 项目 | 解决的问题 |
|---|---|
| `mimo2codex` | 本地代理，把 Codex 的 Responses API 请求转给 Chat Completions 兼容模型，并提供 provider 路由 |
| `codex-mimo-skill` | Codex workflow 工具，把文案、UI/UX、frontend first-pass 这些任务显式交给 MiMo |

一句话：`mimo2codex` 更像模型接入层；`codex-mimo-skill` 更像 Codex 协作层。

## 30 秒上手

```bash
npm link
npm run install:skill
```

确认配置：

```bash
codex-mimo health --json
```

先跑 dry-run，不调用模型：

```bash
cmi delegate --mode copywrite --dry-run --json "写一个中文空状态"
```

真实调用：

```bash
cmi delegate --mode naming --json "给一个 ERP 报价异常处理台取三个名字"
```

## 配置

CLI 会按顺序读取：

1. 当前 shell env
2. 当前目录向上找到的 `.env`
3. `/Users/sunny/Work/CODEX/deepseek/.env`
4. `~/.config/codex-mimo-skill/.env`
5. `~/.codex-mimo.env`

支持这些 key 形式：

```bash
export MIMO_API_KEY=...
export mimo_key=...
export XIAOMI_MIMO_API_KEY=...

# 兼容本机 deepseek/.env
export ollamaApiKey=...
export mimo_URL_openai=https://token-plan-ams.xiaomimimo.com/v1
```

可选：

```bash
export MIMO_MODEL=mimo-v2.5-pro
export MIMO_BASE_URL=https://token-plan-ams.xiaomimimo.com/v1
```

## Modes

| Mode | 用途 |
|---|---|
| `copywrite` | 标题、副标题、CTA、空态、错误态、onboarding |
| `rewrite-cn` | 不改事实的中文润色 |
| `naming` | 产品、功能、页面、动作、概念命名 |
| `human-feedback` | 写给同事、客户、用户的自然反馈 |
| `layout-director` | 页面信息架构、模块顺序、视觉节奏 |
| `frontend-ux-plan` | 完整 UI/UX 方案，Codex 负责实现 |
| `frontend-first-pass` | G2 内部 UI 完整首版候选源码，Codex 接入和验证 |
| `visual-brief` | 给图片生成或 UI 参考图写 brief |
| `ui-review-cn` | 审中文 UI 用语、术语、层级、排版 |
| `general` | 混合型 MiMo 任务 |

## Frontend First Pass 边界

`frontend-first-pass` 只适合 G2 内部页面、ERP console、dashboard、prototype 和可丢弃首版。MiMo 可以产出完整候选源码，但不能直接改仓库，也不能跳过 Codex 验证。

Codex 接手后必须检查：

- CSS/module imports 是否接上
- `document.title` 是否不是默认 `app`
- disabled button 是否有 visible hint、tooltip 或校验文案
- normal / search / empty / completed 等关键状态是否完整
- 390px 和 1440px 是否无横向溢出
- `lint`、`build`/typecheck、浏览器截图和主交互是否通过

不适合交给 MiMo 单独负责的范围：生产 React/Next 架构、复杂状态管理、支付/权限/数据写入、G3 模块、SEO/a11y 合规页面。

## 示例

中文 UI review：

```bash
cmi delegate --mode ui-review-cn --json \
  --input ./app/page.tsx \
  "审核中文 UI 文案、信息层级和排版节奏"
```

内部前端首版：

```bash
cmi delegate --mode frontend-first-pass --json \
  --context "stack: Vite React TS; no new dependencies" \
  --context "target: internal ERP quote exception console" \
  "输出 App.tsx、App.css、index.css 的完整候选内容，并列出 Codex 验证清单"
```

给同事写自然反馈：

```bash
cmi delegate --mode human-feedback --json \
  --context "tone: 像真人，不要 AI 味，不要公关腔" \
  "给 Lucas 写一段项目反馈"
```

## Codex Skill

安装：

```bash
npm run install:skill
```

安装后，未来 Codex session 可以按 `codex-mimo` 的规则，在文案、中文表达、命名、视觉 brief、human feedback、UI/UX、内部前端首版等任务里自动调用 MiMo。

## License

MIT
