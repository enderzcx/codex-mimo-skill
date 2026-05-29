import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildCodexExecArgs,
  buildCodexHarnessPrompt,
  parseJsonlEvents,
  runCodexHarness,
} from "../src/codex-harness.mjs";

test("builds a Codex harness prompt with MiMo role and user task", () => {
  const prompt = buildCodexHarnessPrompt({
    mode: "frontend-ux-plan",
    system: "Role: MiMo UI/UX",
    prompt: "Task: build ERP page",
    json: true,
  });

  assert.match(prompt, /MiMo system prompt/);
  assert.match(prompt, /Role: MiMo UI\/UX/);
  assert.match(prompt, /Task: build ERP page/);
  assert.match(prompt, /single JSON object/);
});

test("builds codex exec args with sandbox, profile, model, schema, and config", () => {
  const args = buildCodexExecArgs({
    prompt: "hello",
    cwd: "/tmp/repo",
    model: "mimo-v2.5-pro",
    profile: "mimo",
    profileV2: "mimo-v2",
    sandbox: "read-only",
    outputSchema: "/tmp/schema.json",
    config: ["model_provider=mimo"],
    lastMessageFile: "/tmp/last.txt",
  });

  assert.deepEqual(args.slice(0, 2), ["exec", "--json"]);
  assert.ok(args.includes("--output-last-message"));
  assert.ok(args.includes("--cd"));
  assert.ok(args.includes("--sandbox"));
  assert.ok(args.includes("--profile"));
  assert.ok(args.includes("--profile-v2"));
  assert.ok(args.includes("--model"));
  assert.ok(args.includes("--output-schema"));
  assert.ok(args.includes("--config"));
  assert.equal(args.at(-1), "hello");
});

test("runs codex exec and reads the output-last-message file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cmi-codex-harness-"));
  const fakeCodex = join(dir, "fake-codex.mjs");
  writeFileSync(fakeCodex, `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const out = args[args.indexOf("--output-last-message") + 1];
const prompt = args.at(-1);
process.stdout.write(JSON.stringify({ type: "exec.started" }) + "\\n");
writeFileSync(out, JSON.stringify({
  summary: prompt.includes("MiMo") ? "harness ok" : "missing prompt",
  deliverables: [{ type: "brief", title: "Plan", content: "Use Codex context." }],
  notes: [],
  next_for_codex: ["integrate"]
}));
`, "utf8");
  chmodSync(fakeCodex, 0o755);

  const result = await runCodexHarness({
    codexBin: fakeCodex,
    cwd: dir,
    prompt: "MiMo harness task",
    sandbox: "read-only",
    timeoutMs: 1000,
  });

  assert.match(result.stdout, /harness ok/);
  assert.equal(result.events.length, 1);
  assert.equal(result.command[0], fakeCodex);
  assert.ok(result.command.includes("--output-last-message"));
});

test("parses codex JSONL events and preserves raw text lines", () => {
  const events = parseJsonlEvents("{\"type\":\"ok\"}\nnot-json\n");
  assert.deepEqual(events[0], { type: "ok" });
  assert.deepEqual(events[1], { type: "raw", text: "not-json" });
});
