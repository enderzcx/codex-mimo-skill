export function renderDelegateResult(payload, { raw = "" } = {}) {
  const result = payload && typeof payload === "object" ? payload : {};
  const lines = [];
  const mode = result.mode ? ` (${result.mode})` : "";
  lines.push(`# MiMo result${mode}`);

  if (result.summary) {
    lines.push("", String(result.summary).trim());
  }

  const deliverables = Array.isArray(result.deliverables) ? result.deliverables : [];
  for (const item of deliverables) {
    if (!item || typeof item !== "object") continue;
    const title = item.title || item.type || "deliverable";
    lines.push("", `## ${title}`);
    if (item.content) lines.push("", String(item.content).trim());
  }

  const notes = Array.isArray(result.notes) ? result.notes.filter(Boolean) : [];
  if (notes.length) {
    lines.push("", "## Notes");
    for (const note of notes) lines.push(`- ${String(note).trim()}`);
  }

  const next = Array.isArray(result.next_for_codex) ? result.next_for_codex.filter(Boolean) : [];
  if (next.length) {
    lines.push("", "## Next For Codex");
    for (const action of next) lines.push(`- ${String(action).trim()}`);
  }

  if (result.parse_status === "raw-fallback" || result.parse_status === "schema-fallback") {
    const rawText = raw || deliverables.find((item) => item?.title === "raw")?.content || "";
    lines.push("", "## Raw Model Output");
    lines.push("", String(rawText).trim() || "(empty)");
  }

  return `${lines.join("\n").trim()}\n`;
}
