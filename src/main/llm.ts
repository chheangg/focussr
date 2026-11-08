const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * Asks whichever model is running on this computer, through the OpenAI-compatible API that
 * Ollama, LM Studio and llama.cpp all serve. Loopback only, so nothing can leave the machine.
 * Set FOCUSSR_LLM_URL and FOCUSSR_LLM_MODEL to point at a different local server.
 */
export async function askLocalModel(prompt: string): Promise<string | null> {
  const url = process.env.FOCUSSR_LLM_URL ?? 'http://127.0.0.1:11434/v1/chat/completions'
  if (!LOOPBACK.has(new URL(url).hostname)) return null
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: process.env.FOCUSSR_LLM_MODEL ?? 'llama3.2',
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!response.ok) return null
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] }
    return data.choices?.[0]?.message?.content?.trim() || null
  } catch {
    return null
  }
}
