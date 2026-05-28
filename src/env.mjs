import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const SHARED_ENVS = [
  "/Users/sunny/Work/CODEX/deepseek/.env",
  join(homedir(), ".config", "codex-mimo-skill", ".env"),
  join(homedir(), ".codex-mimo.env"),
];

export function loadMimoEnv() {
  const loaded = [];
  const seen = new Set();
  const candidates = process.env.CODEX_MIMO_ENV
    ? [process.env.CODEX_MIMO_ENV]
    : [findUpEnv(process.cwd()), ...SHARED_ENVS];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const path = resolve(candidate);
    if (seen.has(path) || !existsSync(path)) continue;
    seen.add(path);
    applyEnvFile(path);
    loaded.push(path);
  }

  return loaded;
}

export function resolveMimoConfig({ model, baseUrl } = {}) {
  const envFiles = loadMimoEnv();
  const configuredBaseUrl = baseUrl ?? process.env.MIMO_BASE_URL ?? process.env.MIMO_URL_OPENAI ?? process.env.mimo_URL_openai;
  const apiKey =
    process.env.MIMO_API_KEY ??
    process.env.mimo_key ??
    process.env.XIAOMI_MIMO_API_KEY ??
    (configuredBaseUrl ? process.env.ollamaApiKey : undefined);

  return {
    apiKey,
    baseUrl: configuredBaseUrl ?? "https://token-plan-ams.xiaomimimo.com/v1",
    model: model ?? process.env.MIMO_MODEL ?? "mimo-v2.5-pro",
    envFiles,
    hasKey: Boolean(apiKey),
  };
}

function findUpEnv(startDir) {
  let dir = resolve(startDir || ".");
  while (true) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function applyEnvFile(path) {
  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r\n|\n|\r/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const { key, value } = parsed;
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) return null;

  const key = match[1];
  let value = match[2].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  } else {
    value = value.replace(/\s+#.*$/, "");
  }
  return { key, value };
}
