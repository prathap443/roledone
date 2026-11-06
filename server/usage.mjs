// Usage accounting: tokens, estimated cost and latency per call, aggregated per model and per tool.
// Prices are USD per million tokens; override with ROLEDONE_PRICES='{"claude-x":{"in":2,"out":10,"cacheRead":0.1,"cacheWrite":2.5}}'.

const DEFAULT_PRICES = {
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
};

export function createUsage({ prices = DEFAULT_PRICES, env = process.env, now = () => Date.now() } = {}) {
  let table = prices;
  if (env.ROLEDONE_PRICES) { try { table = { ...prices, ...JSON.parse(env.ROLEDONE_PRICES) }; } catch { console.error('[usage] ROLEDONE_PRICES is not valid JSON; using defaults'); } }
  const started = now();
  const zero = () => ({ calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, usd: 0, ms: 0, errors: 0 });
  const byModel = {}, byTool = {};
  const recent = [];

  const price = (model) => table[model] || table[Object.keys(table).find((k) => model.startsWith(k))] || null;
  const cost = (model, u) => {
    const p = price(model);
    if (!p) return null;
    return ((u.input || 0) * p.in + (u.output || 0) * p.out + (u.cacheRead || 0) * p.cacheRead + (u.cacheWrite || 0) * p.cacheWrite) / 1e6;
  };

  return {
    /** Record one model call. `tokens` = {input, output, cacheRead, cacheWrite} as reported by the API. */
    record({ model, tool, tokens, ms, error = false }) {
      const usd = error ? 0 : cost(model, tokens) ?? 0;
      for (const bucket of [(byModel[model] ||= zero()), (byTool[tool] ||= zero())]) {
        bucket.calls++; bucket.ms += ms; if (error) bucket.errors++;
        bucket.input += tokens.input || 0; bucket.output += tokens.output || 0;
        bucket.cacheRead += tokens.cacheRead || 0; bucket.cacheWrite += tokens.cacheWrite || 0;
        bucket.usd += usd;
      }
      recent.push({ at: now(), model, tool, ...tokens, ms, usd: Number(usd.toFixed(5)), error });
      if (recent.length > 200) recent.shift();
      return usd;
    },
    /** Aggregate view for /api/usage. */
    summary() {
      const total = zero();
      for (const b of Object.values(byModel)) for (const k of Object.keys(total)) total[k] += b[k];
      const promptTokens = total.input + total.cacheRead + total.cacheWrite;
      const round = (b) => ({ ...b, usd: Number(b.usd.toFixed(4)), avgMs: b.calls ? Math.round(b.ms / b.calls) : 0, ms: undefined });
      return {
        since: new Date(started).toISOString(),
        total: round(total),
        cacheHitRate: promptTokens ? Number((total.cacheRead / promptTokens).toFixed(3)) : 0,
        byModel: Object.fromEntries(Object.entries(byModel).map(([k, v]) => [k, round(v)])),
        byTool: Object.fromEntries(Object.entries(byTool).map(([k, v]) => [k, round(v)])),
        recent: recent.slice(-20),
        pricesKnownFor: Object.keys(table),
      };
    },
  };
}
