import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildMimo2CodexArgs,
  buildMimo2CodexCodexConfig,
  buildMimo2CodexEnv,
} from "../src/mimo2codex-adapter.mjs";

test("builds minimal mimo2codex start args", () => {
  assert.deepEqual(buildMimo2CodexArgs({ host: "127.0.0.1", port: 8788 }), [
    "--host",
    "127.0.0.1",
    "--port",
    "8788",
    "--no-reasoning",
  ]);
  assert.deepEqual(buildMimo2CodexArgs({ host: "127.0.0.1", port: 8788, noReasoning: false, noAdmin: true }), [
    "--host",
    "127.0.0.1",
    "--port",
    "8788",
    "--no-admin",
  ]);
});

test("maps cmi MiMo env aliases into mimo2codex env names", () => {
  const dir = mkdtempSync(join(tmpdir(), "cmi-m2c-env-"));
  const envFile = join(dir, ".env");
  writeFileSync(envFile, "mimo_key=tp-test-key\nmimo_URL_openai=https://token-plan.example/v1\n", "utf8");
  const snapshot = {
    CODEX_MIMO_ENV: process.env.CODEX_MIMO_ENV,
    MIMO_API_KEY: process.env.MIMO_API_KEY,
    MIMO_BASE_URL: process.env.MIMO_BASE_URL,
    mimo_key: process.env.mimo_key,
    mimo_URL_openai: process.env.mimo_URL_openai,
  };

  try {
    process.env.CODEX_MIMO_ENV = envFile;
    delete process.env.MIMO_API_KEY;
    delete process.env.MIMO_BASE_URL;
    delete process.env.mimo_key;
    delete process.env.mimo_URL_openai;

    const { env, config } = buildMimo2CodexEnv();
    assert.equal(config.apiKey, "tp-test-key");
    assert.equal(config.baseUrl, "https://token-plan.example/v1");
    assert.equal(env.MIMO_API_KEY, "tp-test-key");
    assert.equal(env.MIMO_BASE_URL, "https://token-plan.example/v1");
  } finally {
    restoreEnv(snapshot);
  }
});

test("builds one-shot Codex config for a local Responses adapter", () => {
  const config = buildMimo2CodexCodexConfig({ host: "127.0.0.1", port: 8788, provider: "m2c" });
  assert.equal(config.length, 2);
  assert.match(config[0], /model_providers\.m2c/);
  assert.match(config[0], /base_url = "http:\/\/127\.0\.0\.1:8788\/v1"/);
  assert.match(config[0], /wire_api = "responses"/);
  assert.match(config[1], /model_provider="m2c"/);
});

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
