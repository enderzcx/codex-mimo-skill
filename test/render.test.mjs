import assert from "node:assert/strict";
import test from "node:test";
import { renderDelegateResult } from "../src/render.mjs";

test("renders parsed MiMo payload as stable markdown", () => {
  const rendered = renderDelegateResult({
    mode: "copywrite",
    summary: "copy ready",
    deliverables: [{ type: "copy", title: "Empty State", content: "还没有数据" }],
    notes: ["keep it short"],
    next_for_codex: ["apply to UI"],
  });

  assert.match(rendered, /# MiMo result \(copywrite\)/);
  assert.match(rendered, /## Empty State/);
  assert.match(rendered, /还没有数据/);
  assert.match(rendered, /## Next For Codex/);
});

test("renders raw model output when JSON parsing failed", () => {
  const rendered = renderDelegateResult({
    mode: "copywrite",
    parse_status: "raw-fallback",
    summary: "MiMo returned non-JSON content.",
    deliverables: [{ type: "note", title: "raw", content: "plain copy" }],
  }, { raw: "plain copy" });

  assert.match(rendered, /MiMo returned non-JSON content/);
  assert.match(rendered, /## Raw Model Output/);
  assert.match(rendered, /plain copy/);
});
