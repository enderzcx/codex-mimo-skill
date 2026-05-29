import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("README documents rendered/raw result handling", () => {
  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /默认不用起任何服务/);
  assert.match(readme, /wire_api = "responses"/);
  assert.match(readme, /mimo2codex/);
  assert.match(readme, /cmi result <job-id>/);
  assert.match(readme, /cmi result --json <job-id>/);
  assert.match(readme, /rendered/);
  assert.match(readme, /raw/);
  assert.match(readme, /raw fallback/);
});

test("skill documents MiMo result handling discipline", () => {
  const skill = readFileSync("skills/codex-mimo/SKILL.md", "utf8");
  assert.match(skill, /Result Handling/);
  assert.match(skill, /cmi result <job-id>/);
  assert.match(skill, /cmi result --json <job-id>/);
  assert.match(skill, /raw fallback/);
  assert.match(skill, /does not start a service/);
  assert.match(skill, /wire_api = "responses"/);
  assert.match(skill, /Do not say MiMo was used unless a command was actually run/);
  assert.match(skill, /runtime\.md/);
  assert.match(skill, /result-handling\.md/);
  assert.match(skill, /prompt-templates\.md/);
});

test("split skill docs keep runtime, result, and prompt concerns separate", () => {
  const runtime = readFileSync("skills/codex-mimo/runtime.md", "utf8");
  const results = readFileSync("skills/codex-mimo/result-handling.md", "utf8");
  const prompts = readFileSync("skills/codex-mimo/prompt-templates.md", "utf8");
  assert.match(runtime, /cmi delegate/);
  assert.match(runtime, /starts no service/);
  assert.match(results, /source-of-truth/);
  assert.match(results, /raw-fallback/);
  assert.match(prompts, /Frontend first pass/);
});

test("AGENTS keeps plugin-cc-style background and result contract", () => {
  const agents = readFileSync("AGENTS.md", "utf8");
  assert.match(agents, /openai\/codex-plugin-cc/);
  assert.match(agents, /cmi delegate --mode <mode> --background --json/);
  assert.match(agents, /cmi result --json <job-id>/);
  assert.match(agents, /raw fallback/);
});
