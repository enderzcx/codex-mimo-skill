export const MIMO_MODES = [
  "copywrite",
  "rewrite-cn",
  "naming",
  "human-feedback",
  "layout-director",
  "frontend-ux-plan",
  "frontend-first-pass",
  "visual-brief",
  "ui-review-cn",
  "general",
];

const MODE_TITLES = {
  copywrite: "产品文案协作者",
  "rewrite-cn": "中文润色协作者",
  naming: "产品/功能命名协作者",
  "human-feedback": "真人反馈消息协作者",
  "layout-director": "页面信息架构与视觉节奏导演",
  "frontend-ux-plan": "前端 UI/UX 方案协作者",
  "frontend-first-pass": "G2 内部前端首版实现协作者",
  "visual-brief": "视觉参考图与 UI brief 协作者",
  "ui-review-cn": "中文 UI 文案与排版 review 协作者",
  general: "Codex 的 MiMo 协作者",
};

const MODE_INSTRUCTIONS = {
  copywrite: "写标题、副标题、CTA、空状态、错误态、onboarding、tooltip 或产品叙事。保留事实，不要擅自实现代码。",
  "rewrite-cn": "在不改事实的前提下润色中文表达，让它更像目标说话者或目标产品语气。",
  naming: "给产品、功能、页面、动作或概念命名。说明含义、适用场景和风险。",
  "human-feedback": "写给同事、客户、合伙人的自然消息。要求像真人，避免 AI 味、过度礼貌、口号和公关腔。",
  "layout-director": "输出页面信息层级、模块顺序、视觉节奏、内容密度和取舍理由。不要输出完整代码。",
  "frontend-ux-plan": "输出完整 UI/UX 方案：目标用户、信息架构、关键状态、响应式、可访问性、实现注意点。Codex 会负责代码。",
  "frontend-first-pass": "为 G2 内部 UI、dashboard、console 或 prototype 输出完整前端首版候选源码和 UX 说明。允许给完整文件内容，但不要声称已改仓库；Codex 会接入、修机械问题、验证并最终裁决。",
  "visual-brief": "输出给图像生成或 UI 参考图的 brief：主体、构图、材质、色彩、光线、比例、禁用项。",
  "ui-review-cn": "审中文 UI 文案、术语、层级、排版节奏、视觉呈现和可读性。若附了截图，必须基于截图可见内容做视觉批判；按 must/fix/later 给建议。",
  general: "根据任务给内容、设计或产品表达建议。Codex 是工程执行者和最终裁决者。",
};

const modeAliases = new Map([
  ["copywriting", "copywrite"],
  ["copy-draft", "copywrite"],
  ["rewrite", "rewrite-cn"],
  ["feedback", "human-feedback"],
  ["human", "human-feedback"],
  ["layout", "layout-director"],
  ["uiux", "frontend-ux-plan"],
  ["ux", "frontend-ux-plan"],
  ["frontend", "frontend-first-pass"],
  ["frontend-first", "frontend-first-pass"],
  ["first-pass", "frontend-first-pass"],
  ["visual", "visual-brief"],
  ["ui-review", "ui-review-cn"],
  ["ui_review", "ui-review-cn"],
]);

export function normalizeMode(mode) {
  const raw = String(mode || "general").trim();
  const normalized = modeAliases.get(raw) ?? raw;
  if (!MIMO_MODES.includes(normalized)) {
    throw new Error(`unsupported MiMo mode: ${mode}`);
  }
  return normalized;
}

export function buildSystemPrompt(mode, json = false) {
  const normalized = normalizeMode(mode);
  const title = MODE_TITLES[normalized] ?? MODE_TITLES.general;
  const instruction = MODE_INSTRUCTIONS[normalized] ?? MODE_INSTRUCTIONS.general;
  const outputContract = json
    ? `Return ONLY a valid JSON object with:
{
  "summary": "one sentence",
  "deliverables": [{"type": "copy|brief|review|plan|code|note", "title": "short title", "content": "markdown"}],
  "notes": ["short caveat"],
  "next_for_codex": ["concrete next action"]
}`
    : "Return concise Markdown. Put actionable output first, caveats second.";
  const modeSpecific =
    normalized === "frontend-first-pass"
      ? `
Frontend first-pass guardrails:
- Fit the existing stack and file boundaries named by Codex. Do not add dependencies unless Codex explicitly allowed them.
- Include every required import, including CSS/module imports. If CSS is separate, name exactly where it is imported.
- Set a meaningful document title when the framework allows it.
- Disabled buttons must explain why they are disabled with inline helper text, tooltip/title, or visible validation copy.
- Cover normal, loading, empty, error, filtered/search, and completed states when relevant.
- Include desktop and mobile layout rules; avoid horizontal overflow at 390px and 1440px.
- Preserve accessibility basics: labels, focus states, semantic controls, readable contrast.
- End with a short Codex validation checklist: lint, build/typecheck, browser screenshot, primary interaction, mobile overflow.
`
      : "";

  return `Role: ${title}

You are MiMo working directly with Codex.

Instruction:
${instruction}

Hard contract:
- Codex is the main brain, engineering executor, verifier, and final reviewer.
- You may produce copy, briefs, UX plans, visual constraints, naming, reviews, and first-pass candidate code only when the mode allows it.
- Do not claim files were changed. Codex will apply or reject your output.
- Do not invent facts. Mark uncertain facts as [UNVERIFIED].
- Keep a Chinese developer workflow in mind; Chinese-English technical mix is acceptable when natural.
- Optimize for taste, clarity, human tone, and practical UI detail.
${modeSpecific}

Output:
${outputContract}`;
}

export function buildUserPrompt({ task, contexts = [], files = [], images = [] }) {
  const parts = [];
  parts.push("Task:");
  parts.push(task || "(no explicit task; infer from context and attached files)");
  if (contexts.length > 0) {
    parts.push("\nContext:");
    for (const context of contexts) parts.push(`- ${context}`);
  }
  if (files.length > 0) {
    parts.push("\nAttached files:");
    for (const file of files) {
      const suffix = file.truncated ? "\n[TRUNCATED]" : "";
      parts.push(`--- ${file.path} ---\n${file.content}${suffix}`);
    }
  }
  if (images.length > 0) {
    parts.push("\nAttached images:");
    for (const image of images) {
      parts.push(`- ${image.path} (${image.mime}, ${image.bytes} bytes)`);
    }
    parts.push("Use the attached screenshots directly for visual critique. Do not pretend to see details that are not visible.");
  }
  return parts.join("\n");
}
