import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const DEFAULT_TIMEOUT_MS = 600_000;

export function resolveCodexBin(explicit) {
  const candidate = explicit || process.env.CODEX_MIMO_CODEX_BIN || process.env.CODEX_BIN || "codex";
  if (candidate.includes("/") || candidate.startsWith(".")) return resolve(candidate);
  const found = spawnSync("which", [candidate], { encoding: "utf8" });
  if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  return candidate;
}

export function buildCodexHarnessPrompt({ mode, system, prompt, json }) {
  return [
    "You are running a MiMo delegation inside the Codex execution harness.",
    "",
    "Important boundary:",
    "- Follow the MiMo role and output contract below.",
    "- Use Codex's repository context and tools only when needed for the requested task.",
    "- Do not mutate files unless the caller explicitly chose a writable sandbox.",
    "- Return the useful final answer in the last assistant message.",
    "",
    "MiMo system prompt:",
    "```text",
    system,
    "```",
    "",
    "MiMo user prompt:",
    "```text",
    prompt,
    "```",
    "",
    json
      ? "Final answer requirement: output a single JSON object compatible with the MiMo contract when possible."
      : "Final answer requirement: output concise Markdown.",
  ].join("\n");
}

export async function runCodexHarness({
  codexBin,
  cwd,
  prompt,
  model,
  profile,
  profileV2,
  sandbox = "read-only",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  outputSchema,
  config = [],
} = {}) {
  const resolvedBin = resolveCodexBin(codexBin);
  const workingDir = resolve(cwd || process.cwd());
  const tempDir = join(tmpdir(), `cmi-codex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tempDir, { recursive: true });
  const lastMessageFile = join(tempDir, "last-message.txt");
  const args = buildCodexExecArgs({
    prompt,
    cwd: workingDir,
    model,
    profile,
    profileV2,
    sandbox,
    outputSchema,
    config,
    lastMessageFile,
  });

  try {
    const result = await spawnCodex(resolvedBin, args, {
      cwd: workingDir,
      timeoutMs,
    });
    const lastMessage = existsSync(lastMessageFile) ? readFileSync(lastMessageFile, "utf8") : "";
    return {
      stdout: lastMessage || extractLikelyFinalMessage(result.stdout) || result.stdout,
      stderr: result.stderr,
      events: parseJsonlEvents(result.stdout),
      raw_events: result.stdout,
      command: [resolvedBin, ...args],
      exit_code: result.exitCode,
      signal: result.signal,
      timed_out: result.timedOut,
      cwd: workingDir,
      sandbox,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function buildCodexExecArgs({
  prompt,
  cwd,
  model,
  profile,
  profileV2,
  sandbox,
  outputSchema,
  config = [],
  lastMessageFile,
}) {
  const args = [
    "exec",
    "--json",
    "--output-last-message",
    lastMessageFile,
    "--cd",
    cwd,
    "--sandbox",
    sandbox,
    "--skip-git-repo-check",
  ];
  if (model) args.push("--model", model);
  if (profile) args.push("--profile", profile);
  if (profileV2) args.push("--profile-v2", profileV2);
  if (outputSchema) args.push("--output-schema", outputSchema);
  for (const entry of config) args.push("--config", entry);
  args.push(prompt);
  return args;
}

function spawnCodex(command, args, { cwd, timeoutMs }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, timeoutMs)
      : null;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`codex exec timed out after ${timeoutMs}ms`));
        return;
      }
      if (exitCode !== 0) {
        const detail = stderr.trim() || stdout.trim() || `exit code ${exitCode}`;
        reject(new Error(`codex exec failed: ${detail}`));
        return;
      }
      resolvePromise({ stdout, stderr, exitCode, signal, timedOut });
    });
  });
}

export function parseJsonlEvents(raw) {
  const events = [];
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      events.push({ type: "raw", text: trimmed });
    }
  }
  return events;
}

function extractLikelyFinalMessage(raw) {
  const events = parseJsonlEvents(raw);
  for (const event of events.slice().reverse()) {
    const message =
      event?.msg?.message?.content ??
      event?.message?.content ??
      event?.item?.content ??
      event?.content ??
      event?.text;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return "";
}
