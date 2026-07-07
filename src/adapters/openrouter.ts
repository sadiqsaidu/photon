import type { LlmClient } from "../shared/ports.js";

const URL = "https://openrouter.ai/api/v1/chat/completions";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class OpenRouter implements LlmClient {
  // Free-tier models flake upstream; each model in the chain gets two tries
  // before falling through to the next (OPENROUTER_MODEL is comma-separated).
  constructor(
    private readonly apiKey: string,
    private readonly fallbackModels: string[] = [],
  ) {}

  async complete(model: string, system: string, user: string): Promise<string> {
    const chain = [model, ...this.fallbackModels.filter((m) => m !== model)];
    let lastErr: unknown;
    for (const m of chain) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await this.once(m, system, user);
        } catch (e) {
          lastErr = e;
          await sleep(800);
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private async once(model: string, system: string, user: string): Promise<string> {
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
