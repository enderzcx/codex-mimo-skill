# AGENTS.md

## Project

`codex-mimo-skill` is a Codex-first MiMo integration.

It is not Reasonix and not a Codex API proxy. It gives Codex a small CLI and
skill for asking MiMo v2.5 Pro to help with copy, Chinese expression, UI/UX,
visual briefs, human feedback, and G2 internal frontend first-pass candidates.

## Working Rules

- Keep this repo MiMo-only.
- Do not add DeepSeek / Reasonix review routing here; use `codex-reasonix-bridge` for that.
- Default integration is zero-service `cmi delegate`; do not make a local proxy/adapter the normal path.
- `cmi adapter start` + `cmi harness --mimo2codex` is the optional repo-aware path for MiMo-in-Codex experiments. It uses mimo2codex as a local Responses adapter without editing `~/.codex/config.toml`.
- Codex remains the only production engineering owner and final reviewer.
- `frontend-first-pass` may output candidate code, but Codex must integrate and verify.
- Do not claim affiliation with Xiaomi MiMo or the `mimo2codex` project.
- Credit `7as0nch/mimo2codex` as inspiration/reference when discussing prior art.
- Follow the `openai/codex-plugin-cc` pattern for long work: use tracked background jobs instead of blocking the main session.
- Use `cmi delegate --mode <mode> --background --json "<task>"` for non-trivial `frontend-first-pass`, full `frontend-ux-plan`, large `ui-review-cn`, or long `copywrite`.
- Use `cmi harness --mode frontend-first-pass --mimo2codex --background --json "<task>"` only when MiMo needs repo/tools/sandbox context.
- Manage background jobs with `cmi status <job-id>`, `cmi result <job-id>`, and `cmi cancel <job-id>`.
- Foreground MiMo calls have a 180000ms default timeout and should be used only for quick checks.
- Background jobs must store `result`, `rendered`, and `raw`; `cmi result <job-id>` returns `rendered`, while `cmi result --json <job-id>` returns the full job record.
- MiMo may return JSON, fenced JSON, mixed logs, or plain text. Preserve raw fallback and do not pretend a malformed JSON response means MiMo was not called.

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
