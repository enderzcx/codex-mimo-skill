# Result Handling

Treat `cmi result <job-id>` as source-of-truth output.

- `cmi result <job-id>` returns rendered Markdown for humans.
- `cmi result --json <job-id>` returns the full job record with `result`, `rendered`, `raw`, logs, and errors.
- Preserve concrete copy, UX constraints, visual constraints, candidate file names, and validation checklists.
- If `parse_status` is `raw-fallback`, relay the useful raw output and say the CLI used raw fallback.
- Never claim MiMo was consulted unless a command actually ran.

MiMo output is a brief or candidate, not an automatic patch. Codex applies, edits, and verifies.
