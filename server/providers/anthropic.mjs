// Anthropic Messages API adapter. Structured output is obtained by forcing a single tool call
// whose input schema is the contract we want; the model cannot reply with free text.
// Docs: https://platform.claude.com/docs — note Claude 5.x rejects `temperature`, so none is sent.

const ENDPOINT = process.env.ANTHROPIC_BASE_URL?.replace(/\/$/, '') || 'https://api.anthropic.com';

export function createAnthropicProvider({ apiKey, model = 'claude-sonnet-5-5', timeoutMs = 60000, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for the anthropic provider');
  return {
    name: 'anthropic',
    model,
    /**
     * @param {{system:string,user:string,tool:{name:string,description:string,input_schema:object},maxTokens?:number}} req
     * @returns {Promise<object>} the tool input object
     */
    async complete({ system, user, tool, maxTokens = 4000 }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${ENDPOINT}/v1/messages`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            // Claude 5.x (adaptive thinking) rejects forced tool_choice ("tool"/"any"); "auto" plus an
            // explicit instruction is the supported way to get a single structured tool call.
            system: `${system}\n\nRespond ONLY by calling the ${tool.name} tool with complete input. Do not reply with prose.`,
            messages: [{ role: 'user', content: user }],
            tools: [tool],
            tool_choice: { type: 'auto' },
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          let detail = body.slice(0, 300);
          try { detail = JSON.parse(body).error?.message || detail; } catch { /* keep raw */ }
          const err = new Error(`Anthropic API ${res.status}: ${detail}`);
          err.status = res.status === 429 ? 429 : 502;
          throw err;
        }
        const data = await res.json();
        const content = data.content || [];
        const block = content.find((c) => c.type === 'tool_use' && c.name === tool.name);
        if (block) return block.input;
        // Fallback: the model answered in text. Accept it only if it is a JSON object (possibly fenced).
        const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
        const json = text.match(/\{[\s\S]*\}/)?.[0];
        if (json) { try { return JSON.parse(json); } catch { /* fall through */ } }
        throw Object.assign(new Error(`Model returned no structured output (stop_reason: ${data.stop_reason || 'unknown'})`), { status: 502 });
      } catch (error) {
        if (error.name === 'AbortError') throw Object.assign(new Error('AI request timed out'), { status: 504 });
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
