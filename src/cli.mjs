import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import { stdin, stdout } from "node:process";
import { buildCodexHarnessPrompt, runCodexHarness } from "./codex-harness.mjs";
import { resolveMimoConfig } from "./env.mjs";
import { runMimo } from "./mimo.mjs";
import {
  buildMimo2CodexCodexConfig,
  getMimo2CodexStatus,
  startMimo2Codex,
  stopMimo2Codex,
} from "./mimo2codex-adapter.mjs";
import { buildSystemPrompt, buildUserPrompt, MIMO_MODES, normalizeMode } from "./prompts.mjs";
import { renderDelegateResult } from "./render.mjs";
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
  if (command === "harness" || command === "codex") {
    await harness(rest);
    return;
  }
  if (command === "adapter") {
    await adapter(rest);
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

export async function harness(argv) {
  const opts = parseHarnessArgs(argv);
  const task = opts.task || (await readStdinIfPiped());
  const mode = normalizeMode(opts.mode);
  const files = opts.inputFiles.map(readInputFile);
  const routing = codexHarnessRouteMetadata({ mode, opts, inputFiles: files });

  if (opts.dryRun) {
    writeJson({
      mode,
      routing,
      task: task || null,
      cwd: resolve(opts.cwd || process.cwd()),
      sandbox: opts.sandbox,
      input_files: files.map((file) => ({ path: file.path, bytes: file.bytes, truncated: file.truncated })),
    });
    return;
  }

  if (opts.background) {
    enqueueBackgroundHarness({ opts, task, mode, routing, files });
    return;
  }

  const output = await runHarnessRequest({ opts, task, mode, routing, files });
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

  const wrapped = wrapJsonOutput(result.stdout, mode, routing);
  return {
    raw: result.stdout,
    wrapped,
    rendered: renderDelegateResult(wrapped, { raw: result.stdout }),
  };
}

async function runHarnessRequest({ opts, task, mode, routing, files }) {
  const system = buildSystemPrompt(mode, opts.json);
  const prompt = buildUserPrompt({ task, contexts: opts.contexts, files });
  const codexPrompt = buildCodexHarnessPrompt({ mode, system, prompt, json: opts.json });
  const result = await runCodexHarness({
    codexBin: opts.codexBin,
    cwd: opts.cwd,
    prompt: codexPrompt,
    model: opts.model,
    profile: opts.profile,
    profileV2: opts.profileV2,
    sandbox: opts.sandbox,
    timeoutMs: opts.timeoutMs,
    outputSchema: opts.outputSchema,
    config: opts.config,
  });
  const wrapped = wrapJsonOutput(result.stdout, mode, {
    ...routing,
    codex_command: result.command,
    codex_events: result.events.length,
  });
  return {
    raw: result.stdout,
    raw_events: result.raw_events,
    stderr: result.stderr,
    wrapped,
    rendered: renderDelegateResult(wrapped, { raw: result.stdout }),
  };
}

async function adapter(argv) {
  const opts = parseAdapterArgs(argv);
  if (opts.action === "config") {
    const config = buildMimo2CodexCodexConfig({ host: opts.host, port: opts.port, provider: opts.provider });
    const payload = {
      provider: opts.provider,
      host: opts.host,
      port: opts.port,
      config,
      example: `cmi harness --mimo2codex --mode frontend-first-pass --json "<task>"`,
    };
    if (opts.json) writeJson(payload);
    else writeText(config.map((entry) => `--config '${entry.replace(/'/g, "'\\''")}'`).join(" \\\n"));
    return;
  }

  if (opts.action === "start") {
    const payload = await startMimo2Codex({
      host: opts.host,
      port: opts.port,
      bin: opts.bin,
      model: opts.model,
      baseUrl: opts.baseUrl,
      noReasoning: !opts.reasoning,
      noAdmin: opts.noAdmin,
      timeoutMs: opts.timeoutMs,
    });
    if (opts.json) writeJson(payload);
    else writeText(payload.running ? `mimo2codex running at ${payload.base_url}` : `mimo2codex start requested; check ${payload.log_file ?? "logs"}`);
    return;
  }

  if (opts.action === "stop") {
    const payload = await stopMimo2Codex({ port: opts.port });
    if (opts.json) writeJson(payload);
    else writeText(`mimo2codex stop ${payload.signal_sent ? "sent SIGTERM" : "had no live pid"}.`);
    return;
  }

  const payload = await getMimo2CodexStatus({
    host: opts.host,
    port: opts.port,
    bin: opts.bin,
    timeoutMs: opts.timeoutMs,
  });
  if (opts.json) writeJson(payload);
  else writeText(`${payload.running ? "running" : "not-running"} ${payload.available ? payload.bin : "mimo2codex missing"}`);
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

function enqueueBackgroundHarness({ opts, task, mode, routing, files }) {
  const cwd = resolve(opts.cwd || process.cwd());
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobId = generateJobId("mimo-codex");
  const logFile = resolveJobLogFile(workspaceRoot, jobId);
  const job = createJob(workspaceRoot, {
    id: jobId,
    kind: "harness",
    title: `MiMo Codex harness ${mode}`,
    summary: task ? task.replace(/\s+/g, " ").slice(0, 120) : `${mode} Codex harness task`,
    workspaceRoot,
    status: "queued",
    phase: "queued",
    pid: null,
    logFile,
    routing,
    request: {
      kind: "harness",
      opts: {
        mode: opts.mode,
        contexts: opts.contexts,
        json: true,
        background: false,
        cwd,
        sandbox: opts.sandbox,
        codexBin: opts.codexBin,
        model: opts.model,
        profile: opts.profile,
        profileV2: opts.profileV2,
        outputSchema: opts.outputSchema,
        config: opts.config,
        timeoutMs: opts.timeoutMs ?? 0,
      },
      task,
      mode,
      routing,
      files,
    },
  });
  appendLog(workspaceRoot, jobId, `Queued ${mode} in Codex harness with ${routing.selected_model}.`);
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
    harness: "codex-exec",
    commands: {
      status: `cmi status ${jobId}`,
      result: `cmi result ${jobId}`,
      cancel: `cmi cancel ${jobId}`,
    },
  };
  if (opts.json) writeJson(payload);
  else writeText(`MiMo Codex harness task started in the background as ${jobId}. Check \`cmi status ${jobId}\`.`);
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

export function parseHarnessArgs(argv) {
  const opts = {
    mode: "general",
    inputFiles: [],
    contexts: [],
    json: false,
    dryRun: false,
    background: false,
    cwd: process.cwd(),
    sandbox: "read-only",
    codexBin: undefined,
    model: process.env.CODEX_MIMO_CODEX_MODEL || undefined,
    profile: process.env.CODEX_MIMO_CODEX_PROFILE || undefined,
    profileV2: process.env.CODEX_MIMO_CODEX_PROFILE_V2 || undefined,
    outputSchema: undefined,
    config: [],
    useMimo2Codex: false,
    adapterHost: process.env.CODEX_MIMO_ADAPTER_HOST || "127.0.0.1",
    adapterPort: Number(process.env.CODEX_MIMO_ADAPTER_PORT || 8788),
    adapterProvider: process.env.CODEX_MIMO_ADAPTER_PROVIDER || "mimo2codex",
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
    else if (arg === "--cd" || arg === "--cwd") opts.cwd = requireValue(argv, ++i, arg);
    else if (arg === "--sandbox") opts.sandbox = requireValue(argv, ++i, "--sandbox");
    else if (arg === "--allow-write") opts.sandbox = "workspace-write";
    else if (arg === "--codex-bin") opts.codexBin = requireValue(argv, ++i, "--codex-bin");
    else if (arg === "--model" || arg === "-m") opts.model = requireValue(argv, ++i, arg);
    else if (arg === "--profile") opts.profile = requireValue(argv, ++i, "--profile");
    else if (arg === "--profile-v2") opts.profileV2 = requireValue(argv, ++i, "--profile-v2");
    else if (arg === "--output-schema") opts.outputSchema = requireValue(argv, ++i, "--output-schema");
    else if (arg === "--config") opts.config.push(requireValue(argv, ++i, "--config"));
    else if (arg === "--mimo2codex") opts.useMimo2Codex = true;
    else if (arg === "--adapter-host") opts.adapterHost = requireValue(argv, ++i, "--adapter-host");
    else if (arg === "--adapter-port") opts.adapterPort = Number(requireValue(argv, ++i, "--adapter-port"));
    else if (arg === "--adapter-provider") opts.adapterProvider = requireValue(argv, ++i, "--adapter-provider");
    else if (arg === "--timeout-ms") opts.timeoutMs = parseTimeoutMs(requireValue(argv, ++i, "--timeout-ms"));
    else if (arg === "--help" || arg === "-h") {
      printHarnessHelp();
      process.exit(0);
    } else positional.push(arg);
  }
  if (!Number.isFinite(opts.adapterPort) || opts.adapterPort <= 0) {
    throw new Error("--adapter-port must be a positive number");
  }
  if (opts.useMimo2Codex) {
    opts.model ??= "mimo-v2.5-pro";
    opts.config.push(...buildMimo2CodexCodexConfig({
      host: opts.adapterHost,
      port: opts.adapterPort,
      provider: opts.adapterProvider,
    }));
  }
  opts.task = positional.join(" ").trim();
  return opts;
}

export function parseAdapterArgs(argv) {
  const opts = {
    action: "status",
    json: false,
    host: process.env.CODEX_MIMO_ADAPTER_HOST || "127.0.0.1",
    port: Number(process.env.CODEX_MIMO_ADAPTER_PORT || 8788),
    provider: process.env.CODEX_MIMO_ADAPTER_PROVIDER || "mimo2codex",
    bin: undefined,
    model: undefined,
    baseUrl: undefined,
    reasoning: false,
    noAdmin: false,
    timeoutMs: 5000,
  };
  const actions = new Set(["status", "start", "stop", "config"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (actions.has(arg)) opts.action = arg;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--host") opts.host = requireValue(argv, ++i, "--host");
    else if (arg === "--port") opts.port = Number(requireValue(argv, ++i, "--port"));
    else if (arg === "--provider") opts.provider = requireValue(argv, ++i, "--provider");
    else if (arg === "--bin") opts.bin = requireValue(argv, ++i, "--bin");
    else if (arg === "--model" || arg === "-m") opts.model = requireValue(argv, ++i, arg);
    else if (arg === "--base-url") opts.baseUrl = requireValue(argv, ++i, "--base-url");
    else if (arg === "--reasoning") opts.reasoning = true;
    else if (arg === "--no-admin") opts.noAdmin = true;
    else if (arg === "--timeout-ms") opts.timeoutMs = parseTimeoutMs(requireValue(argv, ++i, "--timeout-ms"));
    else if (arg === "--help" || arg === "-h") {
      printAdapterHelp();
      process.exit(0);
    } else throw new Error(`unknown adapter option: ${arg}`);
  }
  if (!Number.isFinite(opts.port) || opts.port <= 0) throw new Error("--port must be a positive number");
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
    const output = stored.request.kind === "harness"
      ? await runHarnessRequest(stored.request)
      : await runDelegateRequest(stored.request);
    updateJob(cwd, jobId, {
      status: "completed",
      phase: "done",
      pid: null,
      completedAt: nowIso(),
      result: output.wrapped,
      rendered: output.rendered,
      raw: output.raw,
      rawEvents: output.raw_events,
      summary: output.wrapped.summary ?? "MiMo task completed.",
    });
    appendParseStatusLog(cwd, jobId, output.wrapped);
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

function appendParseStatusLog(cwd, jobId, result) {
  const status = result?.parse_status;
  if (!status) return;
  if (status === "raw-fallback" || status === "schema-fallback") {
    appendLog(cwd, jobId, `Output parse status: ${status}; raw output preserved in job record.`);
  } else {
    appendLog(cwd, jobId, `Output parse status: ${status}${result?.parse_source ? ` (${result.parse_source})` : ""}.`);
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
  writeText(stored.rendered ?? renderDelegateResult(stored.result ?? { summary: stored.summary ?? "No result payload stored." }, { raw: stored.raw }));
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

export function codexHarnessRouteMetadata({ mode, opts, inputFiles = [] }) {
  return {
    mode,
    provider: "mimo",
    harness: "codex-exec",
    adapter: opts.useMimo2Codex ? "mimo2codex" : null,
    selected_model: opts.model || "(codex default)",
    codex_profile: opts.profile || null,
    codex_profile_v2: opts.profileV2 || null,
    codex_wire_api_required: "responses",
    true_mimo_in_codex_requires_responses_adapter: true,
    adapter_note: "Latest Codex only accepts wire_api=responses. MiMo's OpenAI-compatible endpoint is chat/completions, so true MiMo-in-Codex needs an existing Responses adapter/profile such as mimo2codex.",
    output_kind: mode === "frontend-first-pass" ? "code-brief" : mode.includes("review") ? "review" : "brief",
    allow_code: opts.sandbox === "workspace-write" || opts.sandbox === "danger-full-access",
    handoff_to: "codex",
    sandbox: opts.sandbox,
    cwd: resolve(opts.cwd || process.cwd()),
    adapter_base_url: opts.useMimo2Codex ? `http://${opts.adapterHost}:${opts.adapterPort}/v1` : null,
    input_files: inputFiles.map((file) => ({ path: file.path, bytes: file.bytes, truncated: file.truncated })),
  };
}

export function wrapJsonOutput(raw, mode, routing) {
  const extracted = extractJsonObject(raw);
  if (extracted?.parsed) {
    const parsed = extracted.parsed;
    const notes = Array.isArray(parsed.notes) ? [...parsed.notes] : [];
    if (extracted.source !== "direct") {
      notes.push("CLI extracted structured JSON from mixed MiMo output.");
    }
    return {
      ...parsed,
      mode: parsed.mode ?? mode,
      routing,
      parse_status: extracted.source === "direct" ? "parsed" : "extracted",
      parse_source: extracted.source,
      ...(notes.length ? { notes } : {}),
    };
  }
  return {
    mode,
    routing,
    parse_status: "raw-fallback",
    parse_source: "raw",
    summary: "MiMo returned non-JSON content.",
    deliverables: [{ type: "note", title: "raw", content: raw.trim() }],
    notes: ["The CLI wrapped the raw response because JSON parsing failed."],
    next_for_codex: [],
  };
}

export function extractJsonObject(raw) {
  const trimmed = stripAnsi(String(raw ?? "")).trim();
  if (!trimmed) return null;
  const direct = parseJsonCandidate(trimmed);
  if (direct) return { parsed: direct, source: "direct" };

  const fenced = chooseBestParsedObject(extractFencedCandidates(trimmed), { minScore: 1 });
  if (fenced) return { parsed: fenced, source: "fenced" };

  const balanced = chooseBestParsedObject(extractBalancedObjectCandidates(trimmed), { minScore: 1 });
  if (balanced) return { parsed: balanced, source: "balanced" };

  return null;
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function parseJsonCandidate(candidate) {
  try {
    const parsed = JSON.parse(candidate.trim());
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractFencedCandidates(raw) {
  const candidates = [];
  const fencePattern = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  let match;
  while ((match = fencePattern.exec(raw)) !== null) {
    if (match[1]?.trim()) candidates.push(match[1].trim());
  }
  return candidates;
}

function extractBalancedObjectCandidates(raw) {
  const candidates = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(raw.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

function chooseBestParsedObject(candidates, { minScore = 0 } = {}) {
  let best = null;
  for (const candidate of candidates) {
    const parsed = parseJsonCandidate(candidate);
    if (!parsed) continue;
    const score = scoreParsedObject(parsed);
    if (score < minScore) continue;
    if (!best || score > best.score || (score === best.score && candidate.length > best.length)) {
      best = { parsed, score, length: candidate.length };
    }
  }
  return best?.parsed ?? null;
}

function scoreParsedObject(value) {
  let score = 0;
  if (typeof value.summary === "string") score += 4;
  if (Array.isArray(value.deliverables)) score += 4;
  if (Array.isArray(value.next_for_codex)) score += 3;
  if (Array.isArray(value.notes)) score += 2;
  if (typeof value.mode === "string") score += 1;
  if (value.routing && typeof value.routing === "object") score += 1;
  return score;
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
  harness [task]    Advanced: run through codex exec when a MiMo-backed Responses profile exists.
  adapter [action]  Optional mimo2codex status/start/stop/config helper.
  status [job-id]   Show background MiMo jobs.
  result [job-id]   Show a completed background MiMo result.
  cancel [job-id]   Cancel an active background MiMo job.
  health            Check MiMo configuration without printing secrets.
  modes             List supported modes.

Run "codex-mimo delegate --help" for delegate options.
Run "codex-mimo harness --help" for Codex harness options.
Run "codex-mimo adapter --help" for optional adapter commands.
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

function printHarnessHelp() {
  stdout.write(`Usage:
  codex-mimo harness [options] [task]

Runs a MiMo delegation prompt inside Codex's \`codex exec\` harness. To make the
model itself be MiMo, pass a MiMo-backed Codex profile/model with --profile,
--profile-v2, --model, or CODEX_MIMO_CODEX_PROFILE / CODEX_MIMO_CODEX_MODEL.
This command does not start a proxy/adapter. Latest Codex requires
\`wire_api = "responses"\`; MiMo's direct endpoint is Chat Completions, so true
MiMo-in-Codex needs an existing Responses adapter/profile such as mimo2codex.
For copy/UI/UX work, prefer zero-service \`cmi delegate\`.

Options:
  --mode <mode>           ${MIMO_MODES.join(" | ")}
  --input <path>          Attach an input file; repeatable.
  --context <text>        Add short context; repeatable.
  --json                  Ask for and emit stable JSON.
  --background            Run as a tracked background job.
  --cd, --cwd <path>      Repository/workspace for codex exec. Default: cwd.
  --sandbox <mode>        Codex sandbox. Default: read-only.
  --allow-write           Shortcut for --sandbox workspace-write.
  --codex-bin <path>      Codex executable. Default: codex.
  -m, --model <id>        Codex model id/profile-backed model. Default: Codex default.
  --profile <name>        Codex config profile.
  --profile-v2 <name>     Codex v2 config profile.
  --mimo2codex            Inject a one-shot local mimo2codex Responses provider config.
  --adapter-host <host>   Local mimo2codex host for --mimo2codex. Default: 127.0.0.1.
  --adapter-port <port>   Local mimo2codex port for --mimo2codex. Default: 8788.
  --adapter-provider <id> Provider id for injected Codex config. Default: mimo2codex.
  --config <key=value>    Extra codex exec config override; repeatable.
  --output-schema <path>  Pass a JSON schema to codex exec.
  --timeout-ms <ms>       Abort stuck codex exec after this many ms. Default: 600000.
  --dry-run               Print routing metadata without calling Codex.
`);
}

function printAdapterHelp() {
  stdout.write(`Usage:
  codex-mimo adapter [status|start|stop|config] [options]

Optional helper for repo-aware MiMo-in-Codex experiments through mimo2codex.
This is not the default path. Use cmi delegate for normal copy/UI/UX work.

Actions:
  status              Check mimo2codex binary, key presence, and local health.
  start               Start mimo2codex in the background with cmi-loaded env.
  stop                Stop the background adapter started by cmi.
  config              Print the one-shot Codex --config values used by --mimo2codex.

Options:
  --json              Emit JSON.
  --host <host>       Default: 127.0.0.1.
  --port <port>       Default: 8788.
  --provider <id>     Provider id for Codex config. Default: mimo2codex.
  --bin <path>        mimo2codex executable. Default: found in PATH.
  -m, --model <id>    MiMo model for env resolution. Default: cmi default.
  --base-url <url>    Override MiMo upstream base URL.
  --reasoning         Do not pass --no-reasoning to mimo2codex.
  --no-admin          Start mimo2codex without the admin UI.
  --timeout-ms <ms>   Start/probe timeout. Default: 5000.
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
