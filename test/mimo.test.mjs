import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMimo } from "../src/mimo.mjs";

test("runs MiMo through OpenAI-compatible chat completions", async () => {
  const originalFetch = globalThis.fetch;
  const savedEnv = snapshotEnv();
  let captured;

  process.env.MIMO_API_KEY = "test-key";
  process.env.MIMO_BASE_URL = "https://mimo.example/v1";
  globalThis.fetch = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "{\"summary\":\"ok\"}" } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const result = await runMimo({
      model: "mimo-v2.5-pro",
      system: "system",
      prompt: "prompt",
      json: true,
    });

    assert.equal(result.stdout, "{\"summary\":\"ok\"}");
    assert.equal(captured.url, "https://mimo.example/v1/chat/completions");
    assert.equal(captured.init.headers.Authorization, "Bearer test-key");
    assert.equal(captured.body.model, "mimo-v2.5-pro");
    assert.deepEqual(captured.body.response_format, { type: "json_object" });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(savedEnv);
  }
});

test("loads MiMo credentials from CR-only .env aliases", async () => {
  const originalFetch = globalThis.fetch;
  const originalCwd = process.cwd();
  const savedEnv = snapshotEnv();
  const dir = mkdtempSync(join(tmpdir(), "codex-mimo-env-"));
  let captured;

  writeFileSync(join(dir, ".env"), "mimo_URL_openai=https://mimo-env.example/v1\rmimo_key=env-key\r");
  for (const key of Object.keys(savedEnv)) delete process.env[key];
  process.env.CODEX_MIMO_ENV = join(dir, ".env");
  process.chdir(dir);

  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "ok" } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const result = await runMimo({
      system: "system",
      prompt: "prompt",
    });

    assert.equal(result.stdout, "ok");
    assert.equal(captured.url, "https://mimo-env.example/v1/chat/completions");
    assert.equal(captured.init.headers.Authorization, "Bearer env-key");
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    restoreEnv(savedEnv);
    rmSync(dir, { recursive: true, force: true });
  }
});

function snapshotEnv() {
  const keys = [
    "CODEX_MIMO_ENV",
    "MIMO_API_KEY",
    "mimo_key",
    "XIAOMI_MIMO_API_KEY",
    "MIMO_BASE_URL",
    "MIMO_URL_OPENAI",
    "mimo_URL_openai",
    "ollamaApiKey",
    "MIMO_MODEL",
  ];
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
