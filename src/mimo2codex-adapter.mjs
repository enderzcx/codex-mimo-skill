import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { resolveMimoConfig } from "./env.mjs";

export const DEFAULT_ADAPTER_HOST = "127.0.0.1";
export const DEFAULT_ADAPTER_PORT = 8788;
export const DEFAULT_ADAPTER_PROVIDER = "mimo2codex";
const DEFAULT_ADAPTER_TIMEOUT_MS = 1500;

export function resolveMimo2CodexBin(explicit) {
  const candidate = explicit || process.env.CODEX_MIMO_MIMO2CODEX_BIN || "mimo2codex";
  if (candidate.includes("/") || candidate.startsWith(".")) return resolve(candidate);
  const found = spawnSync("which", [candidate], { encoding: "utf8" });
  if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  return null;
}

export function buildMimo2CodexEnv({ model, baseUrl } = {}) {
  const config = resolveMimoConfig({ model, baseUrl });
  const env = { ...process.env };
  if (config.apiKey) env.MIMO_API_KEY = config.apiKey;
  if (config.baseUrl) env.MIMO_BASE_URL = config.baseUrl;
  return { env, config };
}

export function buildMimo2CodexArgs({
  host = DEFAULT_ADAPTER_HOST,
  port = DEFAULT_ADAPTER_PORT,
  noReasoning = true,
  noAdmin = false,
} = {}) {
  const args = ["--host", host, "--port", String(port)];
  if (noReasoning) args.push("--no-reasoning");
  if (noAdmin) args.push("--no-admin");
  return args;
}

export function buildMimo2CodexCodexConfig({
  host = DEFAULT_ADAPTER_HOST,
  port = DEFAULT_ADAPTER_PORT,
  provider = DEFAULT_ADAPTER_PROVIDER,
} = {}) {
  return [
    `model_providers.${provider}={ name = "MiMo via mimo2codex", base_url = "http://${host}:${port}/v1", wire_api = "responses", experimental_bearer_token = "mimo2codex-local", request_max_retries = 1 }`,
    `model_provider="${provider}"`,
  ];
}

export async function getMimo2CodexStatus({
  host = DEFAULT_ADAPTER_HOST,
  port = DEFAULT_ADAPTER_PORT,
  bin,
  timeoutMs = DEFAULT_ADAPTER_TIMEOUT_MS,
} = {}) {
  const resolvedBin = resolveMimo2CodexBin(bin);
  const probe = await probeMimo2Codex({ host, port, timeoutMs });
  const state = readAdapterState({ port });
  const config = resolveMimoConfig();
  return {
    available: Boolean(resolvedBin),
    bin: resolvedBin,
    running: probe.ok,
    health_url: `http://${host}:${port}/healthz`,
    base_url: `http://${host}:${port}/v1`,
    port,
    host,
    key_present: Boolean(config.apiKey),
    upstream_base_url: redactUrl(config.baseUrl),
    model: config.model,
    state,
    probe,
  };
}

export async function startMimo2Codex({
  host = DEFAULT_ADAPTER_HOST,
  port = DEFAULT_ADAPTER_PORT,
  bin,
  model,
  baseUrl,
  noReasoning = true,
  noAdmin = false,
  timeoutMs = 5000,
} = {}) {
  const before = await getMimo2CodexStatus({ host, port, bin });
  if (before.running) return { ...before, started: false, already_running: true };
  if (!before.available) {
    throw new Error("mimo2codex not found. Install it with: npm install -g mimo2codex");
  }

  const { env, config } = buildMimo2CodexEnv({ model, baseUrl });
  if (!config.apiKey) {
    throw new Error("MiMo API key missing. cmi can read MIMO_API_KEY, mimo_key, XIAOMI_MIMO_API_KEY, or ollamaApiKey with mimo_URL_openai.");
  }

  const stateDir = adapterStateDir();
  mkdirSync(stateDir, { recursive: true });
  const logFile = join(stateDir, `mimo2codex-${port}.log`);
  const logFd = openSync(logFile, "a");
  const args = buildMimo2CodexArgs({ host, port, noReasoning, noAdmin });
  const child = spawn(before.bin, args, {
    env,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  closeSync(logFd);
  child.unref();

  const state = {
    pid: child.pid ?? null,
    host,
    port,
    bin: before.bin,
    args,
    logFile,
    startedAt: new Date().toISOString(),
    upstream_base_url: redactUrl(config.baseUrl),
    model: config.model,
  };
  writeAdapterState({ port }, state);

  const started = await waitForMimo2Codex({ host, port, timeoutMs });
  return {
    ...(await getMimo2CodexStatus({ host, port, bin })),
    started,
    already_running: false,
    log_file: logFile,
    pid: child.pid ?? null,
  };
}

export async function stopMimo2Codex({ port = DEFAULT_ADAPTER_PORT } = {}) {
  const state = readAdapterState({ port });
  let signalSent = false;
  const pid = Number(state?.pid);
  if (Number.isFinite(pid) && pid > 0) {
    try {
      process.kill(-pid, "SIGTERM");
      signalSent = true;
    } catch {
      try {
        process.kill(pid, "SIGTERM");
        signalSent = true;
      } catch {
        signalSent = false;
      }
    }
  }
  rmSync(adapterStatePath({ port }), { force: true });
  return { stopped: true, signal_sent: signalSent, previous_state: state };
}

export function adapterStateDir() {
  return join(process.env.CODEX_MIMO_STATE_DIR || join(homedir(), ".codex-mimo"), "adapter");
}

export function adapterStatePath({ port = DEFAULT_ADAPTER_PORT } = {}) {
  return join(adapterStateDir(), `mimo2codex-${port}.json`);
}

export function readAdapterState({ port = DEFAULT_ADAPTER_PORT } = {}) {
  const path = adapterStatePath({ port });
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function writeAdapterState({ port = DEFAULT_ADAPTER_PORT } = {}, state) {
  mkdirSync(adapterStateDir(), { recursive: true });
  writeFileSync(adapterStatePath({ port }), `${JSON.stringify(state, null, 2)}\n`);
}

async function waitForMimo2Codex({ host, port, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await probeMimo2Codex({ host, port, timeoutMs: 500 });
    if (probe.ok) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  return false;
}

async function probeMimo2Codex({ host, port, timeoutMs }) {
  const url = `http://${host}:${port}/healthz`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    return { ok: response.ok, status: response.status, body: text.trim().slice(0, 200) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function redactUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "(invalid-url)";
  }
}
