// Grounding validation for AI output.
// Every factual claim the model returns must be anchored in text the user supplied.
// These functions are pure and unit-tested; the API refuses to forward anything that fails them.

export const LIMITS = Object.freeze({
  text: 50000,          // characters per CV / JD / draft
  answer: 20000,        // interview answer
  question: 600,
  requirements: 40,     // max requirements returned per match
  suggestions: 12,      // max suggestions per request
  note: 400,            // characters per free-text note
});

const normalise = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** True when `span` appears verbatim (whitespace-insensitive, case-insensitive) inside `source`. */
export function isSpanOf(span, source) {
  const a = normalise(span), b = normalise(source);
  return a.length > 0 && b.includes(a);
}

/**
 * Find the exact substring of `source` that corresponds to `span`, so the
 * client can highlight or replace it. Returns null when not found.
 */
export function locateSpan(span, source) {
  if (!span || !source) return null;
  if (source.includes(span)) return span;
  // Whitespace-tolerant search: build a regex from the span's tokens.
  const tokens = String(span).trim().split(/\s+/).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!tokens.length) return null;
  const match = new RegExp(tokens.join('\\s+'), 'i').exec(source);
  return match ? match[0] : null;
}

const NUMBER = /\d[\d,.]*\s?(?:%|k\b|m\b|bn\b|x\b)?|£\s?\d[\d,.]*|\$\s?\d[\d,.]*|€\s?\d[\d,.]*/gi;

/** Numeric tokens (metrics, money, years) present in a string, normalised. */
export function numbersIn(text) {
  return new Set((String(text ?? '').match(NUMBER) || []).map((n) => n.replace(/[\s,]/g, '').toLowerCase()));
}

/** Numbers in `proposed` that do not appear anywhere in `allowedSources`. */
export function unsupportedNumbers(proposed, allowedSources) {
  const allowed = new Set();
  for (const src of allowedSources) for (const n of numbersIn(src)) allowed.add(n);
  return [...numbersIn(proposed)].filter((n) => !allowed.has(n));
}

const asText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const STATUSES = new Set(['evidence', 'partial', 'gap']);
const KINDS = new Set(['must', 'nice', 'responsibility']);

/**
 * Validate the model's requirement list against the source JD and CV.
 * - Requirement source must be a span of the JD, otherwise the requirement is dropped.
 * - Evidence must be a span of the CV, otherwise it is removed and status becomes 'gap'.
 * Returns {requirements, dropped, repaired}.
 */
export function validateMatch(raw, { cv, jd }) {
  const out = [];
  let dropped = 0, repaired = 0;
  const seen = new Set();
  for (const item of Array.isArray(raw?.requirements) ? raw.requirements : []) {
    if (out.length >= LIMITS.requirements) break;
    const name = asText(item?.name, 80);
    const source = locateSpan(asText(item?.source, 400), jd);
    if (!name || !source) { dropped++; continue; }
    const key = name.toLowerCase();
    if (seen.has(key)) { dropped++; continue; }
    seen.add(key);
    let evidence = item?.evidence == null ? null : locateSpan(asText(item.evidence, 600), cv);
    let status = STATUSES.has(item?.status) ? item.status : (evidence ? 'evidence' : 'gap');
    if (item?.evidence && !evidence) { repaired++; status = 'gap'; }
    if (!evidence && status !== 'gap') { repaired++; status = 'gap'; }
    if (evidence && status === 'gap') status = 'partial';
    out.push({
      id: `r${out.length + 1}`,
      name,
      kind: KINDS.has(item?.kind) ? item.kind : 'must',
      source,
      evidence,
      status,
      note: asText(item?.note, LIMITS.note),
    });
  }
  return { requirements: out, dropped, repaired };
}

/**
 * Validate proposed CV edits.
 * - `original` must be an exact span of the draft (so the client can apply it).
 * - Every number in `proposed` must already exist in the CV, the draft, or the original span.
 * - `proposed` must not introduce the name of a requirement the user has no evidence for.
 * - Evidence spans must be in the CV; unsupported ones are removed.
 * Returns {suggestions, rejected: [{reason, proposed}]}.
 */
export function validateSuggestions(raw, { cv, draft, requirements = [] }) {
  const out = [], rejected = [];
  const gapNames = requirements.filter((r) => r.status === 'gap').map((r) => normalise(r.name)).filter(Boolean);
  for (const item of Array.isArray(raw?.suggestions) ? raw.suggestions : []) {
    if (out.length >= LIMITS.suggestions) break;
    const original = locateSpan(asText(item?.original, 1200), draft);
    const proposed = asText(item?.proposed, 1200);
    if (!original || !proposed) { rejected.push({ reason: 'original text not found in draft', proposed }); continue; }
    if (normalise(original) === normalise(proposed)) { rejected.push({ reason: 'no change', proposed }); continue; }
    const badNumbers = unsupportedNumbers(proposed, [cv, draft]);
    if (badNumbers.length) { rejected.push({ reason: `unsupported numbers: ${badNumbers.join(', ')}`, proposed }); continue; }
    const p = normalise(proposed);
    const claimsGap = gapNames.find((g) => p.includes(g) && !normalise(original).includes(g) && !normalise(cv).includes(g));
    if (claimsGap) { rejected.push({ reason: `introduces "${claimsGap}" without evidence`, proposed }); continue; }
    const evidence = (Array.isArray(item?.evidence) ? item.evidence : [])
      .map((e) => locateSpan(asText(e, 600), cv)).filter(Boolean).slice(0, 4);
    out.push({
      id: `s${out.length + 1}`,
      requirement: asText(item?.requirement, 80),
      original,
      proposed,
      rationale: asText(item?.rationale, LIMITS.note),
      evidence,
      unsupported: (Array.isArray(item?.unsupported) ? item.unsupported : []).map((u) => asText(u, 200)).filter(Boolean).slice(0, 5),
    });
  }
  return { suggestions: out, rejected };
}

/** Shape-only validation for interview feedback; the model is not asserting facts about the user. */
export function validateFeedback(raw) {
  const part = (k) => ({ present: Boolean(raw?.star?.[k]?.present), note: asText(raw?.star?.[k]?.note, LIMITS.note) });
  const list = (v) => (Array.isArray(v) ? v : []).map((s) => asText(s, LIMITS.note)).filter(Boolean).slice(0, 5);
  return {
    summary: asText(raw?.summary, LIMITS.note),
    star: { situation: part('situation'), task: part('task'), action: part('action'), result: part('result') },
    strengths: list(raw?.strengths),
    improvements: list(raw?.improvements),
    follow_up: asText(raw?.follow_up, LIMITS.note),
  };
}

/** Generated interview questions: shape, caps, and no empty prompts. */
export function validateQuestions(raw, { requirements = [] } = {}) {
  const names = new Set(requirements.map((r) => normalise(r.name)));
  const TYPES = new Set(['depth', 'gap', 'behavioural', 'scenario']);
  const out = [];
  for (const q of Array.isArray(raw?.questions) ? raw.questions : []) {
    if (out.length >= 8) break;
    const prompt = asText(q?.prompt, LIMITS.question);
    if (prompt.length < 15) continue;
    const focus = asText(q?.focus, 80);
    out.push({
      id: `q${out.length + 1}`,
      prompt,
      type: TYPES.has(q?.type) ? q.type : 'depth',
      focus: names.has(normalise(focus)) ? focus : '',
      why: asText(q?.why, LIMITS.note),
      listen_for: (Array.isArray(q?.listen_for) ? q.listen_for : []).map((s) => asText(s, 160)).filter(Boolean).slice(0, 4),
    });
  }
  return { questions: out };
}

/** Gap Interview questions for one requirement. */
export function validateGapQuestions(raw) {
  const questions = (Array.isArray(raw?.questions) ? raw.questions : []).map((q) => asText(q, LIMITS.question)).filter((q) => q.length >= 10).slice(0, 4);
  return { questions, intro: asText(raw?.intro, LIMITS.note) };
}

/**
 * A bullet drafted from the candidate's own Gap Interview answers.
 * Numbers must come from the answers or the CV; names of OTHER gap requirements are not allowed.
 * `verdict` says whether the answers actually support the requirement.
 */
export function validateGapBullet(raw, { cv, answers, requirement, otherGaps = [] }) {
  const verdict = ['supported', 'adjacent', 'unsupported'].includes(raw?.verdict) ? raw.verdict : 'unsupported';
  const bullet = asText(raw?.bullet, 600);
  const explanation = asText(raw?.explanation, LIMITS.note);
  const result = { verdict, bullet: '', explanation, learning_line: asText(raw?.learning_line, 300), rejected: null };
  if (verdict === 'unsupported' || !bullet) return result;
  const sources = [cv, ...answers];
  const badNumbers = unsupportedNumbers(bullet, sources);
  if (badNumbers.length) { result.rejected = `unsupported numbers: ${badNumbers.join(', ')}`; result.verdict = 'unsupported'; return result; }
  const b = normalise(bullet);
  const smuggled = otherGaps.map(normalise).filter((g) => g && g !== normalise(requirement) && b.includes(g) && !sources.some((s) => normalise(s).includes(g)));
  if (smuggled.length) { result.rejected = `introduces "${smuggled[0]}" without evidence`; result.verdict = 'unsupported'; return result; }
  result.bullet = bullet;
  return result;
}

/** Scan summary: strengths must quote the CV; fixes are advice and carry an optional quote. */
export function validateScanSummary(raw, { cv }) {
  const item = (x) => ({ text: asText(x?.text, LIMITS.note), evidence: x?.evidence ? locateSpan(asText(x.evidence, 400), cv) : null });
  const strengths = (Array.isArray(raw?.strengths) ? raw.strengths : []).map(item).filter((x) => x.text && x.evidence).slice(0, 5);
  const fixes = (Array.isArray(raw?.fixes) ? raw.fixes : []).map((x) => ({ ...item(x), why: asText(x?.why, LIMITS.note) })).filter((x) => x.text).slice(0, 3);
  return { headline: asText(raw?.headline, 220), strengths, fixes, target_role: asText(raw?.target_role, 80) };
}
