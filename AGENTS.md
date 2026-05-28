# AGENTS.md

## Project

`codex-mimo-skill` is a Codex-first MiMo integration.

It is not Reasonix and not a Codex API proxy. It gives Codex a small CLI and
skill for asking MiMo v2.5 Pro to help with copy, Chinese expression, UI/UX,
visual briefs, human feedback, and G2 internal frontend first-pass candidates.

## Working Rules

- Keep this repo MiMo-only.
- Do not add DeepSeek / Reasonix review routing here; use `codex-reasonix-bridge` for that.
- Codex remains the only production engineering owner and final reviewer.
- `frontend-first-pass` may output candidate code, but Codex must integrate and verify.
- Do not claim affiliation with Xiaomi MiMo or the `mimo2codex` project.
- Credit `7as0nch/mimo2codex` as inspiration/reference when discussing prior art.
- Follow the `openai/codex-plugin-cc` pattern for long work: use tracked background jobs instead of blocking the main session.
- Use `cmi delegate --mode <mode> --background --json "<task>"` for non-trivial `frontend-first-pass`, full `frontend-ux-plan`, large `ui-review-cn`, or long `copywrite`.
- Manage background jobs with `cmi status <job-id>`, `cmi result <job-id>`, and `cmi cancel <job-id>`.
- Foreground MiMo calls have a 180000ms default timeout and should be used only for quick checks.

## Verification

Run:

```bash
npm test
npm run smoke
```

`npm run smoke` is a dry-run and should not call paid models.

For live model verification:

```bash
codex-mimo delegate --mode layout-director --json "测试一下中文信息架构"
```

For live background verification:

```bash
cmi delegate --mode copywrite --background --json "只回复 ok"
cmi status <job-id>
cmi result <job-id>
```
