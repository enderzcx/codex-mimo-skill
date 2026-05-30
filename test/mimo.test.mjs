import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TIMEOUT_MS, resolveTimeoutMs, runMimo } from "../src/mimo.mjs";

test("resolveTimeoutMs uses default and validates explicit values", () => {
  assert.equal(resolveTimeoutMs(undefined), DEFAULT_TIMEOUT_MS);
  assert.equal(resolveTimeoutMs("0"), 0);
  assert.equal(resolveTimeoutMs("2500"), 2500);
  assert.throws(() => resolveTimeoutMs("-1"), /invalid MiMo timeout/);
  assert.throws(() => resolveTimeoutMs("soon"), /invalid MiMo timeout/);
});

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
      images: [{
        path: "/tmp/screenshot.png",
        mime: "image/png",
        bytes: 12,
        detail: "high",
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      }],
      json: true,
    });

    assert.equal(result.stdout, "{\"summary\":\"ok\"}");
    assert.equal(captured.url, "https://mimo.example/v1/chat/completions");
    assert.equal(captured.init.headers.Authorization, "Bearer test-key");
    assert.equal(captured.body.model, "mimo-v2.5-pro");
    assert.deepEqual(captured.body.response_format, { type: "json_object" });
    assert.equal(captured.body.messages[1].content[0].type, "text");
    assert.equal(captured.body.messages[1].content[1].type, "image_url");
    assert.equal(captured.body.messages[1].content[1].image_url.url, "data:image/png;base64,iVBORw0KGgo=");
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

test("defaults image requests to a MiMo vision model", async () => {
  const originalFetch = globalThis.fetch;
  const savedEnv = snapshotEnv();
  let captured;

  process.env.MIMO_API_KEY = "test-key";
  process.env.MIMO_BASE_URL = "https://mimo.example/v1";
  delete process.env.MIMO_MODEL;
  delete process.env.MIMO_VISION_MODEL;
  delete process.env.MIMO_IMAGE_MODEL;

  globalThis.fetch = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "ok" } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    await runMimo({
      system: "system",
      prompt: "prompt",
      images: [{ dataUrl: "data:image/png;base64,iVBORw0KGgo=" }],
    });

    assert.equal(captured.body.model, "mimo-v2.5");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(savedEnv);
  }
});

test("runMimo fails clearly when fetch times out", async () => {
  const originalFetch = globalThis.fetch;
  const savedEnv = snapshotEnv();

  process.env.MIMO_API_KEY = "test-key";
  process.env.MIMO_BASE_URL = "https://mimo.example/v1";
  globalThis.fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    });

  try {
    await assert.rejects(
      () => runMimo({
        model: "mimo-v2.5-pro",
        system: "system",
        prompt: "prompt",
        timeoutMs: 10,
      }),
      /timed out after 10ms/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(savedEnv);
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
    "MIMO_VISION_MODEL",
    "MIMO_IMAGE_MODEL",
  ];
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
