import assert from "node:assert/strict";
import { execFileSync as run } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createJob } from "../src/state.mjs";

const BIN = resolve("bin/codex-mimo.mjs");

test("result command returns rendered output, not the full job JSON", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cmi-result-contract-"));
  createJob(cwd, {
    id: "mimo-rendered",
    kind: "delegate",
    title: "MiMo copywrite",
    status: "completed",
    summary: "done",
    result: { summary: "done" },
    rendered: "# MiMo result\n\nrendered copy\n",
  });

  const output = run(process.execPath, [BIN, "result", "--cwd", cwd, "mimo-rendered"], { cwd, encoding: "utf8" });
  assert.equal(output, "# MiMo result\n\nrendered copy\n");
});

test("result --json command returns the full job record", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cmi-result-json-contract-"));
  createJob(cwd, {
    id: "mimo-json",
    kind: "delegate",
    title: "MiMo copywrite",
    status: "completed",
    summary: "done",
    result: { summary: "done" },
    rendered: "# MiMo result\n\nrendered copy\n",
    raw: "{\"summary\":\"done\"}",
  });

  const output = run(process.execPath, [BIN, "result", "--json", "--cwd", cwd, "mimo-json"], { cwd, encoding: "utf8" });
  const payload = JSON.parse(output);
  assert.equal(payload.id, "mimo-json");
  assert.equal(payload.status, "completed");
  assert.deepEqual(payload.result, { summary: "done" });
  assert.equal(payload.rendered, "# MiMo result\n\nrendered copy\n");
  assert.equal(payload.raw, "{\"summary\":\"done\"}");
});

test("result command renders legacy jobs without a stored rendered field", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cmi-result-legacy-contract-"));
  createJob(cwd, {
    id: "mimo-legacy",
    kind: "delegate",
    title: "MiMo legacy",
    status: "completed",
    summary: "legacy summary",
    result: {
      mode: "copywrite",
      summary: "legacy summary",
      deliverables: [{ type: "copy", title: "Legacy Copy", content: "old job still works" }],
      next_for_codex: ["keep compatibility"],
    },
  });

  const output = run(process.execPath, [BIN, "result", "--cwd", cwd, "mimo-legacy"], { cwd, encoding: "utf8" });
  assert.match(output, /# MiMo result \(copywrite\)/);
  assert.match(output, /Legacy Copy/);
  assert.match(output, /old job still works/);
});

test("background delegate returns a job id without calling MiMo synchronously", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cmi-background-contract-"));
  const savedEnv = {
    CODEX_MIMO_ENV: process.env.CODEX_MIMO_ENV,
    MIMO_API_KEY: process.env.MIMO_API_KEY,
    MIMO_BASE_URL: process.env.MIMO_BASE_URL,
  };
  process.env.MIMO_API_KEY = "test-key";
  process.env.MIMO_BASE_URL = "https://mimo.example/v1";
  delete process.env.CODEX_MIMO_ENV;

  try {
    const started = Date.now();
    const output = run(process.execPath, [
      BIN,
      "delegate",
      "--mode",
      "copywrite",
      "--background",
      "--json",
      "slow copy",
    ], { cwd, encoding: "utf8" });
    const elapsed = Date.now() - started;
    const payload = JSON.parse(output);

    assert.equal(payload.status, "queued");
    assert.match(payload.job_id, /^mimo-/);
    assert.ok(elapsed < 1000, `background command waited ${elapsed}ms`);
  } finally {
    restoreEnv(savedEnv);
  }
});

test("harness dry-run exposes Codex harness routing without calling Codex", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cmi-harness-dry-run-"));
  const output = run(process.execPath, [
    BIN,
    "harness",
    "--mode",
    "frontend-ux-plan",
    "--profile",
    "mimo",
    "--model",
    "mimo-v2.5-pro",
    "--cd",
    cwd,
    "--json",
    "--dry-run",
    "plan a UI",
  ], { cwd, encoding: "utf8" });
  const payload = JSON.parse(output);

  assert.equal(payload.mode, "frontend-ux-plan");
  assert.equal(payload.routing.harness, "codex-exec");
  assert.equal(payload.routing.selected_model, "mimo-v2.5-pro");
  assert.equal(payload.routing.codex_profile, "mimo");
  assert.equal(payload.routing.sandbox, "read-only");
  assert.equal(payload.routing.codex_wire_api_required, "responses");
  assert.equal(payload.routing.true_mimo_in_codex_requires_responses_adapter, true);
});

test("harness --mimo2codex injects one-shot Responses adapter config", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cmi-harness-m2c-dry-run-"));
  const output = run(process.execPath, [
    BIN,
    "harness",
    "--mode",
    "frontend-first-pass",
    "--mimo2codex",
    "--adapter-port",
    "8788",
    "--cd",
    cwd,
    "--json",
    "--dry-run",
    "draft a repo-aware UI",
  ], { cwd, encoding: "utf8" });
  const payload = JSON.parse(output);

  assert.equal(payload.routing.adapter, "mimo2codex");
  assert.equal(payload.routing.selected_model, "mimo-v2.5-pro");
  assert.equal(payload.routing.adapter_base_url, "http://127.0.0.1:8788/v1");
  assert.equal(payload.routing.codex_wire_api_required, "responses");
});

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
