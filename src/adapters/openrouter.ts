import type { LlmClient } from "../shared/ports.js";

const URL = "https://openrouter.ai/api/v1/chat/completions";

export class OpenRouter implements LlmClient {
  constructor(private readonly apiKey: string) {}

  async complete(model: string, system: string, user: string): Promise<string> {
    const res = await fetch(URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": "https://github.com/sadiqsaidu/photon",
        "X-Title": "Photon",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
      }),
    });
    const body = (await res.json()) as {
      choices?: { message: { content: string } }[];
      error?: { message: string };
    };
    if (body.error) throw new Error(`openrouter: ${body.error.message}`);
    const text = body.choices?.[0]?.message?.content;
    if (!text) throw new Error("openrouter: empty response");
    return text;
  }
}
