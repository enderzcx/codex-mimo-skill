import test from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, buildUserPrompt, normalizeMode } from "../src/prompts.mjs";
import { parseDelegateArgs, routeMetadata, wrapJsonOutput } from "../src/cli.mjs";

test("normalizes mode aliases", () => {
  assert.equal(normalizeMode("copywriting"), "copywrite");
  assert.equal(normalizeMode("uiux"), "frontend-ux-plan");
  assert.equal(normalizeMode("frontend"), "frontend-first-pass");
});

test("frontend first-pass prompt includes guardrails", () => {
  const prompt = buildSystemPrompt("frontend-first-pass", true);
  assert.match(prompt, /CSS\/module imports/);
  assert.match(prompt, /document title/);
  assert.match(prompt, /Disabled buttons/);
  assert.match(prompt, /390px/);
  assert.match(prompt, /Codex validation checklist/);
});

test("user prompt includes context and files", () => {
  const prompt = buildUserPrompt({
    task: "review UI",
    contexts: ["audience: internal ERP users"],
    files: [{ path: "/tmp/app.tsx", content: "hello", truncated: false }],
  });
  assert.match(prompt, /review UI/);
  assert.match(prompt, /internal ERP users/);
  assert.match(prompt, /--- \/tmp\/app.tsx ---/);
});

test("wraps non-json output", () => {
  const routing = routeMetadata({
    mode: "copywrite",
    config: {
      model: "mimo-v2.5-pro",
      baseUrl: "https://mimo.example/v1",
      hasKey: true,
      envFiles: [],
    },
  });
  const wrapped = wrapJsonOutput("hello", "copywrite", routing);
  assert.equal(wrapped.mode, "copywrite");
  assert.equal(wrapped.routing.provider, "mimo");
  assert.equal(wrapped.parse_status, "raw-fallback");
  assert.equal(wrapped.deliverables[0].content, "hello");
});

test("extracts fenced JSON from mixed MiMo output", () => {
  const routing = routeMetadata({
    mode: "copywrite",
    config: {
      model: "mimo-v2.5-pro",
      baseUrl: "https://mimo.example/v1",
      hasKey: true,
      envFiles: [],
    },
  });
  const wrapped = wrapJsonOutput([
    "model log",
    "```json",
    JSON.stringify({
      summary: "copy done",
      deliverables: [{ type: "copy", title: "CTA", content: "开始试试" }],
      notes: [],
      next_for_codex: ["apply copy"],
    }),
    "```",
  ].join("\n"), "copywrite", routing);

  assert.equal(wrapped.summary, "copy done");
  assert.equal(wrapped.parse_status, "extracted");
  assert.equal(wrapped.parse_source, "fenced");
  assert.equal(wrapped.deliverables[0].content, "开始试试");
  assert.match(wrapped.notes.at(-1), /extracted structured JSON/);
});

test("parses background and timeout delegate controls", () => {
  const opts = parseDelegateArgs(["--background", "--timeout-ms", "0", "--mode", "frontend-first-pass", "build UI"]);
  assert.equal(opts.background, true);
  assert.equal(opts.timeoutMs, 0);
  assert.equal(opts.mode, "frontend-first-pass");
  assert.equal(opts.task, "build UI");
});
