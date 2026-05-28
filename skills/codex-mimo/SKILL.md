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
- G2 internal admin / ERP / dashboard / prototype frontend first-pass work

## Role Boundary

- Codex owns product thinking, requirement interpretation, engineering plans, repo integration, bug diagnosis, code edits, tests, accessibility, responsive behavior, context management, and final judgment.
- MiMo owns copy, Chinese expression, UI wording, layout direction, visual briefs, naming, human feedback, frontend UI/UX aesthetics, Chinese UI review, and G2 internal frontend first-pass candidates.
- DeepSeek / Reasonix review belongs in `codex-reasonix-bridge`, not here.

## Command

Prefer:

```bash
codex-mimo delegate --mode <mode> --json "<task>"
```

Short alias:

```bash
cmi delegate --mode <mode> --json "<task>"
```

Attach files:

```bash
codex-mimo delegate --mode ui-review-cn --json \
  --input ./app/page.tsx \
  "审核中文 UI 文案、信息层级和排版节奏"
```

Health check:

```bash
codex-mimo health --json
```

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
- `ui-review-cn`: review Chinese UI language, terminology, hierarchy, layout rhythm
- `general`: mixed MiMo task fallback

## Frontend First Pass Gate

For `frontend-first-pass`, Codex must check:

- CSS/module imports are actually connected.
- Browser title is meaningful, not the scaffold default.
- Disabled controls explain what unlocks them.
- Normal, search/filter, empty, completed, desktop, and mobile states render.
- 390px and 1440px have no horizontal overflow.
- `lint`, `build`/typecheck, browser screenshot, and one primary interaction pass.

Do not use MiMo as an unsupervised production React/Next owner. Production integration, API/data/state architecture, complex permissions/payments/G3 modules, SEO/a11y compliance, and final review stay with Codex.

## Discipline

MiMo output is content/design/review/candidate-code input, not an unconditional patch.

Codex must:

1. Summarize which mode was called.
2. State the main suggestions.
3. Say what was applied or intentionally ignored.
4. Verify any code/UI changes itself.

If MiMo cannot be called, state the exact command attempted and the error, then continue with Codex's own judgment instead of pretending MiMo was consulted.
