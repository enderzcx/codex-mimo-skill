import { resolveMimoConfig } from "./env.mjs";

export async function runMimo({ model, baseUrl, system, prompt, json = false }) {
  const config = resolveMimoConfig({ model, baseUrl });
  if (!config.apiKey) {
    throw new Error("MiMo API key missing. Set MIMO_API_KEY, mimo_key, or ollamaApiKey with mimo_URL_openai.");
  }

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
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
