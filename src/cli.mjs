import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { stdin, stdout } from "node:process";
import { resolveMimoConfig } from "./env.mjs";
import { runMimo } from "./mimo.mjs";
import { buildSystemPrompt, buildUserPrompt, MIMO_MODES, normalizeMode } from "./prompts.mjs";

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

  const result = await runMimo({
    model: config.model,
    baseUrl: config.baseUrl,
    system,
    prompt,
    json: opts.json,
  });

  if (!opts.json) {
    stdout.write(result.stdout);
    if (!result.stdout.endsWith("\n")) stdout.write("\n");
    return;
  }

  writeJson(wrapJsonOutput(result.stdout, mode, routing));
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
    model: undefined,
    baseUrl: undefined,
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
    else if (arg === "--model" || arg === "-m") opts.model = requireValue(argv, ++i, arg);
    else if (arg === "--base-url") opts.baseUrl = requireValue(argv, ++i, "--base-url");
    else if (arg === "--help" || arg === "-h") {
      printDelegateHelp();
      process.exit(0);
    } else positional.push(arg);
  }
  opts.task = positional.join(" ").trim();
  return opts;
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

function printHelp() {
  stdout.write(`codex-mimo

Commands:
  delegate [task]   Ask MiMo for copy, UI/UX, naming, or frontend first-pass help.
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
  -m, --model <id>     Override MiMo model. Default: mimo-v2.5-pro.
  --base-url <url>     Override OpenAI-compatible base URL.
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
