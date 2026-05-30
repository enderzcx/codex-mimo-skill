---
name: codex-mimo
description: Use MiMo v2.5 Pro directly from Codex for Chinese copy, naming, human feedback, UI/UX taste, visual briefs, Chinese UI review, and G2 internal frontend first-pass candidates.
---

# codex-mimo

Use this skill when a Codex task touches:

- Chinese or English product copy
- hero title, subtitle, CTA, empty/error/onboarding/tooltip copy
- landing page information hierarchy
- UI layout direction, visual rhythm, and content density
- brand voice, naming, product terminology
- Chinese expression polishing
- human-sounding feedback to coworkers or customers
- visual reference image briefs
- screenshot-based UI/UX critique after Codex captures browser screenshots
- G2 internal admin / ERP / dashboard / prototype frontend first-pass work

## Role Boundary

- Codex owns product thinking, requirement interpretation, engineering plans, repo integration, bug diagnosis, code edits, tests, accessibility, responsive behavior, context management, and final judgment.
- MiMo owns copy, Chinese expression, UI wording, layout direction, visual briefs, naming, human feedback, frontend UI/UX aesthetics, Chinese UI review, and G2 internal frontend first-pass candidates.
- DeepSeek / Reasonix review belongs in `codex-reasonix-bridge`, not here.

Companion docs in this skill:

- [runtime.md](runtime.md): exact command/runtime rules
- [result-handling.md](result-handling.md): how to relay rendered/raw output
- [prompt-templates.md](prompt-templates.md): safe delegation prompt templates

## Command

Fast direct MiMo call:

```bash
codex-mimo delegate --mode <mode> --json "<task>"
```

Short alias:

```bash
cmi delegate --mode <mode> --json "<task>"
```

Default to `cmi delegate`: it calls MiMo directly and does not start a service.

Advanced Codex harness call, only when an existing MiMo-backed Responses profile/adapter is already configured:

```bash
cmi harness --mode <mode> --profile <mimo-codex-profile> --json "<task>"
```

Preferred one-shot local adapter form:

```bash
cmi adapter start --json
cmi harness --mode <mode> --mimo2codex --json "<task>"
```

`harness` means `codex exec` harness. Latest Codex requires `wire_api = "responses"`; MiMo's direct OpenAI-compatible endpoint is Chat Completions, so true MiMo-in-Codex needs a Responses adapter such as `mimo2codex`. `--mimo2codex` injects a one-shot local Codex provider config and does not edit `~/.codex/config.toml` or overwrite OpenAI login.

Attach files:

```bash
codex-mimo delegate --mode ui-review-cn --json \
  --input ./app/page.tsx \
  "审核中文 UI 文案、信息层级和排版节奏"
```

Attach screenshots for true MiMo vision review:

```bash
cmi delegate --mode ui-review-cn --json \
  --input ./app/page.tsx \
  --image /tmp/page-desktop.png \
  --image /tmp/page-mobile.png \
  "基于代码和截图审核 UI 文案、视觉层级、密度、对齐和移动端问题"
```

`--input` is text-only. Use `--image` for screenshots/images. Direct `cmi delegate --image` sends image payloads to MiMo when the configured endpoint supports image input. Xiaomi MiMo docs list `mimo-v2.5` / `mimo-v2-omni` for image understanding, so `cmi delegate --image` defaults to `mimo-v2.5`; text tasks still default to `mimo-v2.5-pro`. `cmi harness --image` only passes image path metadata into the Codex harness prompt and is not the default visual-review path.

Do not claim MiMo saw screenshots unless `cmi delegate --image ...` actually succeeds. If the endpoint returns `No endpoints found that support image input`, Codex must do browser screenshot/pixel checks itself and may pass textual observations to MiMo.

Health check:

```bash
codex-mimo health --json
```

## Background Jobs

For long-running MiMo tasks, use background mode to avoid blocking the Codex workflow:

```bash
cmi delegate --mode <mode> --background --json "<task>"
```

Use background `cmi harness` only for an existing MiMo-backed Responses profile:

```bash
cmi adapter start --json
cmi harness --mode <mode> --mimo2codex --background --json "<task>"
```

The command returns immediately with a job ID. Manage tasks with:

- `cmi status <job-id>`: check job status
- `cmi result <job-id>`: retrieve rendered output once completed
- `cmi result --json <job-id>`: retrieve the full job record, including `result`, `rendered`, `raw`, and errors
- `cmi cancel <job-id>`: abort a running job

Foreground tasks default to `--timeout-ms 180000` (3 min). Background tasks default to `timeoutMs: 0` (no timeout) unless explicitly passed.

Use background mode for:

- `frontend-first-pass`: generating full candidate source code
- `frontend-ux-plan`: creating comprehensive UI/UX plans
- `ui-review-cn`: reviewing large or complex UI components
- `copywrite`: drafting lengthy, multi-state copy

For quick tasks like `naming` or `rewrite-cn`, foreground mode is usually enough.

## Result Handling

MiMo can return JSON, fenced JSON, or plain text. The CLI extracts structured JSON when possible and preserves raw model output when parsing fails.

Codex must read the actual foreground output or `cmi result <job-id>` before summarizing. Do not say MiMo was used unless a command was actually run. If MiMo returns useful raw text instead of JSON, relay the useful content and mention that the CLI used raw fallback.

## Credentials

- The CLI reads the current shell env first, then `.env` files.
- This machine's default shared env is `/Users/sunny/Work/CODEX/deepseek/.env`.
- Supported key forms: `MIMO_API_KEY`, `mimo_key`, `XIAOMI_MIMO_API_KEY`, or `ollamaApiKey` when paired with `mimo_URL_openai`.
- Never print secret values; only report whether the key is present.

## Modes

- `copywrite`: product copy, headings, subtitles, CTA, empty/error/onboarding states
- `rewrite-cn`: polish Chinese writing without changing facts
- `naming`: product, feature, page, action, concept names
- `human-feedback`: natural feedback messages to coworkers/customers
- `layout-director`: page IA, module order, visual rhythm
- `frontend-ux-plan`: full UI/UX plan Codex will implement
- `frontend-first-pass`: complete G2 internal UI first-pass candidate files for Codex to integrate and verify
- `visual-brief`: brief for image generation or UI reference image
- `ui-review-cn`: review Chinese UI language, terminology, hierarchy, layout rhythm, and attached screenshots when provided
- `general`: mixed MiMo task fallback

## Frontend First Pass Gate

For `frontend-first-pass`, Codex must check:

- CSS/module imports are actually connected.
- Browser title is meaningful, not the scaffold default.
- Disabled controls explain what unlocks them.
- Normal, search/filter, empty, completed, desktop, and mobile states render.
- 390px and 1440px have no horizontal overflow.
- `lint`, `build`/typecheck, browser screenshot, and one primary interaction pass.

After screenshots are captured, Codex should call:

```bash
cmi delegate --mode ui-review-cn --json --image <desktop.png> --image <mobile.png> "<review request>"
```

Codex still owns the final visual judgment and browser verification.

Do not use MiMo as an unsupervised production React/Next owner. Production integration, API/data/state architecture, complex permissions/payments/G3 modules, SEO/a11y compliance, and final review stay with Codex.

## Discipline

MiMo output is content/design/review/candidate-code input, not an unconditional patch.

Codex must:

1. State which command and mode were called.
2. Read `cmi result <job-id>` or the foreground JSON before summarizing.
3. Preserve concrete copy, UX constraints, and validation checklists; do not summarize them away.
4. Say what Codex applied or intentionally ignored.
5. Verify any code/UI changes itself.

If MiMo cannot be called, state the exact command attempted and the error, then continue with Codex's own judgment instead of pretending MiMo was consulted.
