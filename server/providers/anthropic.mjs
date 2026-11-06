// Anthropic Messages API adapter.
//
// Cost controls built in:
//  - two model tiers: `quality` (match, suggestions) and `fast` (everything else)
//  - prompt caching: the same tool set + system prompt + CV open every request, marked with
//    cache_control, so a session pays full price for the CV once and ~5-10% afterwards
//  - effort: Claude 5.x thinks by default at high effort; we ask for `low` and fall back
//    cleanly if a model rejects the parameter
// Claude 5.x also rejects `temperature` and forced `tool_choice`, so neither is sent.

const ENDPOINT = process.env.ANTHROPIC_BASE_URL?.replace(/\/$/, '') || 'https://api.anthropic.com';

export function createAnthropicProvider({
  apiKey,
  model = 'claude-sonnet-5-5',
  fastModel = 'claude-haiku-5-5',
  effort = 'low',
  timeoutMs = 90000,
  fetchImpl = fetch,
  log = console,
  usage = null, // createUsage() instance; optional
} = {}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for the anthropic provider');
  const supportsEffort = new Map(); // model -> boolean, learned from the first 400

  async function call(body, signal) {
    return fetchImpl(`${ENDPOINT}/v1/messages`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
  }

  return {
    name: 'anthropic',
    model,
    fastModel,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 },
    /**
     * @param {object} req
     * @param {string} req.system            static instructions (identical across calls → cached)
     * @param {Array<{text:string,cache?:boolean}>} req.blocks  user content in cache-friendly order (CV first)
     * @param {string} [req.user]            legacy single-string prompt
     * @param {object} req.tool              the tool to call
     * @param {object[]} [req.tools]         full tool set (identical across calls → cached); defaults to [tool]
     * @param {'quality'|'fast'} [req.tier]
     */
    async complete({ system, blocks, user, tool, tools, tier = 'quality', maxTokens = 4000 }) {
      const chosen = tier === 'fast' ? fastModel : model;
      const content = blocks
        ? blocks.map((b) => (b.cache ? { type: 'text', text: b.text, cache_control: { type: 'ephemeral' } } : { type: 'text', text: b.text }))
        : [{ type: 'text', text: user }];
      const toolSet = tools && tools.length ? tools : [tool];
      const base = {
        model: chosen,
        max_tokens: maxTokens,
        system: [{ type: 'text', text: `${system}\n\nRespond ONLY by calling the tool named in the final instruction, with complete input. Do not reply with prose.`, cache_control: { type: 'ephemeral' } }],
        tools: toolSet,
        tool_choice: { type: 'auto' },
        messages: [{ role: 'user', content: [...content, { type: 'text', text: `Call the ${tool.name} tool now.` }] }],
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const t0 = Date.now();
      try {
        let body = supportsEffort.get(chosen) === false ? base : { ...base, output_config: { effort } };
        let res = await call(body, controller.signal);
        if (res.status === 400 && body.output_config) {
          const text = await res.text();
          if (/effort|output_config|thinking/i.test(text)) { supportsEffort.set(chosen, false); res = await call(base, controller.signal); }
          else res = new Response(text, { status: 400 });
        } else if (res.ok && body.output_config) supportsEffort.set(chosen, true);
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          let detail = text.slice(0, 300);
          try { detail = JSON.parse(text).error?.message || detail; } catch { /* keep raw */ }
          const err = new Error(`Anthropic API ${res.status}: ${detail}`);
          err.status = res.status === 429 ? 429 : 502;
          throw err;
        }
        const data = await res.json();
        const u = data.usage || {};
        const tokens = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 };
        const ms = Date.now() - t0;
        this.usage.calls++; this.usage.input += tokens.input; this.usage.output += tokens.output; this.usage.cacheRead += tokens.cacheRead; this.usage.cacheWrite += tokens.cacheWrite;
        const usd = usage?.record({ model: chosen, tool: tool.name, tokens, ms });
        log.info?.(`[ai] ${chosen} ${tool.name} ${ms}ms in=${tokens.input} cacheRead=${tokens.cacheRead} cacheWrite=${tokens.cacheWrite} out=${tokens.output}${usd != null ? ` ~$${usd.toFixed(4)}` : ''}`);
        const blocksOut = data.content || [];
        const block = blocksOut.find((c) => c.type === 'tool_use' && c.name === tool.name) || blocksOut.find((c) => c.type === 'tool_use');
        if (block) return block.input;
        const text = blocksOut.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
        const json = text.match(/\{[\s\S]*\}/)?.[0];
        if (json) { try { return JSON.parse(json); } catch { /* fall through */ } }
        throw Object.assign(new Error(`Model returned no structured output (stop_reason: ${data.stop_reason || 'unknown'})`), { status: 502 });
      } catch (error) {
        usage?.record({ model: chosen, tool: tool.name, tokens: {}, ms: Date.now() - t0, error: true });
        if (error.name === 'AbortError') throw Object.assign(new Error('AI request timed out'), { status: 504 });
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
