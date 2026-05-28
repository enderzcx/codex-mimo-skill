import { resolveMimoConfig } from "./env.mjs";

export const DEFAULT_TIMEOUT_MS = 180_000;

export function resolveTimeoutMs(value = process.env.CMI_TIMEOUT_MS ?? process.env.CODEX_MIMO_TIMEOUT_MS) {
  if (value === undefined || value === null || value === "") return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid MiMo timeout: ${value}`);
  }
  return parsed;
}

export async function runMimo({ model, baseUrl, system, prompt, json = false, timeoutMs = resolveTimeoutMs() }) {
  const config = resolveMimoConfig({ model, baseUrl });
  if (!config.apiKey) {
    throw new Error("MiMo API key missing. Set MIMO_API_KEY, mimo_key, or ollamaApiKey with mimo_URL_openai.");
  }

  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(new Error(`MiMo run timed out after ${timeoutMs}ms`)), timeoutMs)
    : null;
  timer?.unref?.();

  let response;
  try {
    response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller?.signal,
      body: JSON.stringify({
        model: config.model,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        stream: false,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error(
        `MiMo run timed out after ${timeoutMs}ms with model ${config.model}. ` +
          "Try --background for long UI/copy work or pass a higher --timeout-ms.",
      );
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = payload?.error?.message ?? text.trim() ?? `HTTP ${response.status}`;
    throw new Error(`MiMo run failed: ${detail}`);
  }

  const stdout = payload?.choices?.[0]?.message?.content;
  if (typeof stdout !== "string") {
    throw new Error("MiMo run failed: response did not include choices[0].message.content");
  }

  return { stdout, model: config.model, baseUrl: config.baseUrl, envFiles: config.envFiles };
}
