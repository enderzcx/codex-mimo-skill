# Runtime

Use `cmi` only for MiMo copy, naming, human feedback, UI/UX, visual brief, Chinese UI review, and G2 internal frontend first-pass candidates.

Preferred command:

```bash
cmi delegate --mode <mode> --json "<task>"
```

Use direct delegate for copy/brief/review/frontend first-pass work where attached files are enough. This is the default because it starts no service and does not modify Codex config.

Use Codex harness mode only when MiMo should run through `codex exec` with repo context, sandbox, JSONL events, and Codex result handling. The preferred local adapter is `mimo2codex`:

```bash
cmi adapter start --json
cmi harness --mode <mode> --mimo2codex --json "<task>"
```

`cmi harness` is an adapter into Codex's harness, not a second harness. Latest Codex requires `wire_api = "responses"`; MiMo's direct OpenAI-compatible endpoint is Chat Completions, so true MiMo-in-Codex needs a Responses adapter such as `mimo2codex`. `--mimo2codex` injects a one-shot local Codex provider config and does not edit `~/.codex/config.toml`.

For writable first-pass experiments, only with a MiMo-backed Responses profile:

```bash
cmi harness --mode frontend-first-pass --mimo2codex --allow-write --json "<task>"
```

Long work should run in the background:

```bash
cmi delegate --mode frontend-first-pass --background --json "<task>"
cmi adapter start --json
cmi harness --mode frontend-first-pass --mimo2codex --background --json "<task>"
cmi status <job-id>
cmi result <job-id>
cmi cancel <job-id>
```

Stop the optional adapter when the repo-aware experiment is done:

```bash
cmi adapter stop --json
```

Use `cmi health --json` to verify configuration without printing secrets.
