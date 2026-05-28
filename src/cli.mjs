import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import { stdin, stdout } from "node:process";
import { resolveMimoConfig } from "./env.mjs";
import { runMimo } from "./mimo.mjs";
import { buildSystemPrompt, buildUserPrompt, MIMO_MODES, normalizeMode } from "./prompts.mjs";
import {
  appendLog,
  createJob,
  generateJobId,
  isActiveStatus,
  listJobs,
  nowIso,
  readJob,
  resolveJobLogFile,
  resolveJobReference,
  resolveWorkspaceRoot,
  updateJob,
} from "./state.mjs";

const INPUT_FILE_BYTE_CAP = 48 * 1024;

export async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "delegate") {
    await delegate(rest);
    return;
  }
  if (command === "job-worker") {
    await jobWorker(rest);
    return;
  }
  if (command === "status") {
    status(rest);
    return;
  }
  if (command === "result") {
    result(rest);
    return;
  }
  if (command === "cancel") {
    cancel(rest);
    return;
  }
  if (command === "health") {
    await health(rest);
    return;
  }
  if (command === "modes") {
    stdout.write(`${MIMO_MODES.join("\n")}\n`);
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

export async function delegate(argv) {
  const opts = parseDelegateArgs(argv);
  const task = opts.task || (await readStdinIfPiped());
  const mode = normalizeMode(opts.mode);
  const files = opts.inputFiles.map(readInputFile);
  const system = buildSystemPrompt(mode, opts.json);
  const prompt = buildUserPrompt({ task, contexts: opts.contexts, files });
  const config = resolveMimoConfig({ model: opts.model, baseUrl: opts.baseUrl });
  const routing = routeMetadata({ mode, config, json: opts.json, inputFiles: files });

  if (opts.dryRun) {
    writeJson({
      mode,
      routing,
      task: task || null,
      input_files: files.map((file) => ({ path: file.path, bytes: file.bytes, truncated: file.truncated })),
    });
    return;
  }

  if (opts.background) {
    enqueueBackgroundDelegate({ opts, task, mode, config, routing, files });
    return;
  }

  const output = await runDelegateRequest({ opts, task, mode, config, routing, files });
  if (opts.json) writeJson(output.wrapped);
  else writeText(output.raw);
}

async function runDelegateRequest({ opts, task, mode, config, routing, files }) {
  const system = buildSystemPrompt(mode, opts.json);
  const prompt = buildUserPrompt({ task, contexts: opts.contexts, files });
  const result = await runMimo({
    model: config.model,
    baseUrl: config.baseUrl,
    system,
    prompt,
    json: opts.json,
    timeoutMs: opts.timeoutMs,
  });

  return {
    raw: result.stdout,
    wrapped: wrapJsonOutput(result.stdout, mode, routing),
  };
}

function writeText(value) {
  stdout.write(value);
  if (!value.endsWith("\n")) stdout.write("\n");
}

function enqueueBackgroundDelegate({ opts, task, mode, config, routing, files }) {
  const cwd = resolve(process.cwd());
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobId = generateJobId("mimo");
  const logFile = resolveJobLogFile(workspaceRoot, jobId);
  const job = createJob(workspaceRoot, {
    id: jobId,
    kind: "delegate",
    title: `MiMo ${mode}`,
    summary: task ? task.replace(/\s+/g, " ").slice(0, 120) : `${mode} task`,
    workspaceRoot,
    status: "queued",
    phase: "queued",
    pid: null,
    logFile,
    routing,
    request: {
      opts: {
        mode: opts.mode,
        contexts: opts.contexts,
        json: true,
        model: opts.model,
        baseUrl: opts.baseUrl,
        timeoutMs: opts.timeoutMs ?? 0,
      },
      task,
      mode,
      config,
      routing,
      files,
    },
  });
  appendLog(workspaceRoot, jobId, `Queued ${mode} with ${routing.selected_model}.`);
  const child = spawn(process.execPath, [process.argv[1], "job-worker", "--cwd", workspaceRoot, "--job-id", jobId], {
    cwd: workspaceRoot,
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  updateJob(workspaceRoot, job.id, { pid: child.pid ?? null });

  const payload = {
    job_id: jobId,
    status: "queued",
    mode,
    selected_model: routing.selected_model,
    commands: {
      status: `cmi status ${jobId}`,
      result: `cmi result ${jobId}`,
      cancel: `cmi cancel ${jobId}`,
    },
  };
  if (opts.json) writeJson(payload);
  else writeText(`MiMo task started in the background as ${jobId}. Check \`cmi status ${jobId}\` for progress.`);
}

async function health(argv) {
  const opts = parseHealthArgs(argv);
  const config = resolveMimoConfig({ model: opts.model, baseUrl: opts.baseUrl });
  const payload = {
    ok: config.hasKey,
    model: config.model,
    base_url: redactUrl(config.baseUrl),
    key_present: config.hasKey,
    env_files: config.envFiles,
  };
  if (opts.json) writeJson(payload);
  else stdout.write(`${payload.ok ? "ok" : "missing-key"} ${JSON.stringify(payload, null, 2)}\n`);
}

export function parseDelegateArgs(argv) {
  const opts = {
    mode: "general",
    inputFiles: [],
    contexts: [],
    json: false,
    dryRun: false,
    background: false,
    model: undefined,
    baseUrl: undefined,
    timeoutMs: undefined,
    task: "",
  };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode") opts.mode = requireValue(argv, ++i, "--mode");
    else if (arg === "--input") opts.inputFiles.push(requireValue(argv, ++i, "--input"));
    else if (arg === "--context") opts.contexts.push(requireValue(argv, ++i, "--context"));
    else if (arg === "--json") opts.json = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--background") opts.background = true;
    else if (arg === "--model" || arg === "-m") opts.model = requireValue(argv, ++i, arg);
    else if (arg === "--base-url") opts.baseUrl = requireValue(argv, ++i, "--base-url");
    else if (arg === "--timeout-ms") opts.timeoutMs = parseTimeoutMs(requireValue(argv, ++i, "--timeout-ms"));
    else if (arg === "--help" || arg === "-h") {
      printDelegateHelp();
      process.exit(0);
    } else positional.push(arg);
  }
  opts.task = positional.join(" ").trim();
  return opts;
}

async function jobWorker(argv) {
  const opts = parseSimpleArgs(argv, ["cwd", "job-id"], []);
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
  const jobId = opts["job-id"];
  if (!jobId) throw new Error("job-worker requires --job-id");
  const stored = readJob(cwd, jobId);
  if (!stored?.request) throw new Error(`job ${jobId} is missing request data`);
  updateJob(cwd, jobId, { status: "running", phase: "running", pid: process.pid, startedAt: nowIso() });
  appendLog(cwd, jobId, "Worker started.");
  try {
    const output = await runDelegateRequest(stored.request);
    updateJob(cwd, jobId, {
      status: "completed",
      phase: "done",
      pid: null,
      completedAt: nowIso(),
      result: output.wrapped,
      raw: output.raw,
      summary: output.wrapped.summary ?? "MiMo task completed.",
    });
    appendLog(cwd, jobId, "Worker completed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateJob(cwd, jobId, {
      status: "failed",
      phase: "failed",
      pid: null,
      completedAt: nowIso(),
      error: message,
    });
    appendLog(cwd, jobId, `Worker failed: ${message}`);
    process.exitCode = 1;
  }
}

function status(argv) {
  const opts = parseSimpleArgs(argv, ["cwd"], ["json", "all"]);
  const cwd = opts.cwd ? resolve(opts.cwd) : resolveWorkspaceRoot(process.cwd());
  const reference = opts._[0] ?? "";
  const jobs = reference ? [resolveJobReference(cwd, reference)].filter(Boolean) : listJobs(cwd).slice(0, opts.all ? 50 : 10);
  if (opts.json) {
    writeJson({ jobs });
    return;
  }
  if (!jobs.length) {
    writeText("No MiMo jobs found.");
    return;
  }
  writeText([
    "| Job | Status | Mode | Model | Summary | Actions |",
    "|---|---|---|---|---|---|",
    ...jobs.map((job) => {
      const actions = isActiveStatus(job.status)
        ? `\`cmi cancel ${job.id}\``
        : `\`cmi result ${job.id}\``;
      return `| ${job.id} | ${job.status ?? ""} | ${job.routing?.mode ?? ""} | ${job.routing?.selected_model ?? ""} | ${escapeCell(job.summary ?? "")} | ${actions} |`;
    }),
  ].join("\n"));
}

function result(argv) {
  const opts = parseSimpleArgs(argv, ["cwd"], ["json"]);
  const cwd = opts.cwd ? resolve(opts.cwd) : resolveWorkspaceRoot(process.cwd());
  const reference = opts._[0] ?? "";
  const job = resolveJobReference(cwd, reference, (candidate) => !isActiveStatus(candidate.status));
  if (!job) throw new Error(reference ? `No finished job found for ${reference}` : "No finished MiMo job found.");
  const stored = readJob(cwd, job.id) ?? job;
  if (opts.json) {
    writeJson(stored);
    return;
  }
  if (stored.status === "failed") {
    writeText(`Job ${stored.id} failed: ${stored.error ?? "unknown error"}`);
    return;
  }
  writeJson(stored.result ?? { summary: stored.summary ?? "No result payload stored." });
}

function cancel(argv) {
  const opts = parseSimpleArgs(argv, ["cwd"], ["json"]);
  const cwd = opts.cwd ? resolve(opts.cwd) : resolveWorkspaceRoot(process.cwd());
  const reference = opts._[0] ?? "";
  const job = resolveJobReference(cwd, reference, (candidate) => isActiveStatus(candidate.status));
  if (!job) throw new Error(reference ? `No active job found for ${reference}` : "No active MiMo job found.");
  const pid = Number(job.pid);
  let signalSent = false;
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
  const next = updateJob(cwd, job.id, {
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    completedAt: nowIso(),
    error: "Cancelled by user.",
  });
  appendLog(cwd, job.id, "Cancelled by user.");
  const payload = { job_id: job.id, status: "cancelled", signal_sent: signalSent };
  if (opts.json) writeJson({ ...payload, job: next });
  else writeText(`Cancelled ${job.id}${signalSent ? "" : " (process was already gone)"}.`);
}

function parseHealthArgs(argv) {
  const opts = { json: false, model: undefined, baseUrl: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--model" || arg === "-m") opts.model = requireValue(argv, ++i, arg);
    else if (arg === "--base-url") opts.baseUrl = requireValue(argv, ++i, "--base-url");
    else if (arg === "--help" || arg === "-h") {
      printHealthHelp();
      process.exit(0);
    } else throw new Error(`unknown health option: ${arg}`);
  }
  return opts;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseTimeoutMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("--timeout-ms must be a non-negative number");
  return parsed;
}

function parseSimpleArgs(argv, valueOptions = [], booleanOptions = []) {
  const valueSet = new Set(valueOptions.map((name) => `--${name}`));
  const boolSet = new Set(booleanOptions.map((name) => `--${name}`));
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (valueSet.has(arg)) opts[arg.slice(2)] = requireValue(argv, ++i, arg);
    else if (boolSet.has(arg)) opts[arg.slice(2)] = true;
    else opts._.push(arg);
  }
  return opts;
}

function readInputFile(path) {
  const content = readFileSync(path, "utf8");
  const truncated = Buffer.byteLength(content, "utf8") > INPUT_FILE_BYTE_CAP;
  const sliced = truncated ? Buffer.from(content).subarray(0, INPUT_FILE_BYTE_CAP).toString("utf8") : content;
  return {
    path,
    content: sliced,
    bytes: Buffer.byteLength(content, "utf8"),
    truncated,
  };
}

async function readStdinIfPiped() {
  try {
    const info = await stat("/dev/stdin");
    if (info.isFIFO() || info.isFile()) {
      return await new Promise((resolve) => {
        let data = "";
        stdin.setEncoding("utf8");
        stdin.on("data", (chunk) => {
          data += chunk;
        });
        stdin.on("end", () => resolve(data.trim()));
      });
    }
  } catch {
    return "";
  }
  return "";
}

export function routeMetadata({ mode, config, inputFiles = [] }) {
  return {
    mode,
    provider: "mimo",
    selected_model: config.model,
    base_url: redactUrl(config.baseUrl),
    output_kind: mode === "frontend-first-pass" ? "code-brief" : mode.includes("review") ? "review" : "brief",
    allow_code: mode === "frontend-first-pass",
    handoff_to: "codex",
    key_present: config.hasKey,
    env_files: config.envFiles,
    input_files: inputFiles.map((file) => ({ path: file.path, bytes: file.bytes, truncated: file.truncated })),
  };
}

export function wrapJsonOutput(raw, mode, routing) {
  const parsed = parseJsonObject(raw);
  if (parsed) {
    return {
      mode,
      routing,
      ...parsed,
      mode: parsed.mode ?? mode,
      routing,
    };
  }
  return {
    mode,
    routing,
    summary: "MiMo returned non-JSON content.",
    deliverables: [{ type: "note", title: "raw", content: raw.trim() }],
    notes: ["The CLI wrapped the raw response because JSON parsing failed."],
    next_for_codex: [],
  };
}

function parseJsonObject(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
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

function writeJson(value) {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function escapeCell(value) {
  return String(value ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").slice(0, 160);
}

function printHelp() {
  stdout.write(`codex-mimo

Commands:
  delegate [task]   Ask MiMo for copy, UI/UX, naming, or frontend first-pass help.
  status [job-id]   Show background MiMo jobs.
  result [job-id]   Show a completed background MiMo result.
  cancel [job-id]   Cancel an active background MiMo job.
  health            Check MiMo configuration without printing secrets.
  modes             List supported modes.

Run "codex-mimo delegate --help" for delegate options.
`);
}

function printDelegateHelp() {
  stdout.write(`Usage:
  codex-mimo delegate [options] [task]

Options:
  --mode <mode>        ${MIMO_MODES.join(" | ")}
  --input <path>       Attach an input file; repeatable.
  --context <text>     Add short context; repeatable.
  --json               Ask for and emit stable JSON.
  --background         Run as a tracked background job. Use for long UI/copy tasks.
  -m, --model <id>     Override MiMo model. Default: mimo-v2.5-pro.
  --base-url <url>     Override OpenAI-compatible base URL.
  --timeout-ms <ms>    Abort a stuck MiMo request after this many ms. Default: 180000.
  --dry-run            Print routing metadata without calling MiMo.
`);
}

function printHealthHelp() {
  stdout.write(`Usage:
  codex-mimo health [options]

Options:
  --json               Emit JSON.
  -m, --model <id>     Override MiMo model.
  --base-url <url>     Override OpenAI-compatible base URL.
`);
}
