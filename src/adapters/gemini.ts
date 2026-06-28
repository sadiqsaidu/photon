import type { LlmClient } from "../shared/ports.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export class Gemini implements LlmClient {
  constructor(private readonly apiKey: string) {}

  async complete(model: string, system: string, user: string): Promise<string> {
    const res = await fetch(`${BASE}/${model}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      }),
    });
    const body = (await res.json()) as {
      candidates?: { content: { parts: { text: string }[] } }[];
      error?: { message: string };
    };
    if (body.error) throw new Error(`gemini: ${body.error.message}`);
    const text = body.candidates?.[0]?.content.parts[0]?.text;
    if (!text) throw new Error("gemini: empty response");
    return text;
  }
}
