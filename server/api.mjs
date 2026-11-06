// HTTP API: JSON endpoints in front of the AI layer, plus static file serving.
// Request bodies are size-capped, rate-limited per client, and never logged.

import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { LIMITS, isLogistics } from './validate.mjs';

const MAX_BODY = 256 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.json': 'application/json', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf' };
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

/** Fixed-window in-memory rate limiter. Sufficient for a single-instance prototype. */
export function createRateLimiter({ limit = 40, windowMs = 15 * 60 * 1000 } = {}) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset < now) { entry = { count: 0, reset: now + windowMs }; hits.set(key, entry); }
    entry.count++;
    if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count), reset: entry.reset };
  };
}

function readJson(req) {
  return new Promise((resolvePromise, reject) => {
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) return reject(new HttpError(415, 'Send application/json'));
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_BODY) return reject(new HttpError(413, 'Request too large'));
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new HttpError(400, 'Invalid JSON')); } });
    req.on('error', () => reject(new HttpError(400, 'Request aborted')));
  });
}

const text = (v, max, field, { required = true } = {}) => {
  if (v == null || v === '') { if (required) throw new HttpError(400, `${field} is required`); return ''; }
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be a string`);
  if (v.length > max) throw new HttpError(413, `${field} exceeds ${max.toLocaleString('en-GB')} characters`);
  return v;
};

const reqList = (v) => (Array.isArray(v) ? v : []).slice(0, LIMITS.requirements)
  .map((r) => ({ name: text(r?.name, 80, 'requirement.name'), status: ['evidence', 'partial', 'gap'].includes(r?.status) ? r.status : 'gap' }))
  .filter((r) => !isLogistics(r.name)); // older saved workspaces may still carry logistics rows

export function createHandler({ ai, root = resolve('dist'), rateLimit = createRateLimiter(), log = console, usage = null } = {}) {
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(JSON.stringify(body));
  };

  async function api(req, res, pathname) {
    if (pathname === '/api/status' && req.method === 'GET') return send(res, 200, ai.status());
    if (pathname === '/api/usage' && req.method === 'GET') {
      // Aggregate token/cost/latency figures since the server started. No document content, no per-user data.
      if (!usage) throw new HttpError(404, 'Usage accounting is not enabled');
      return send(res, 200, usage.summary());
    }
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    if (!ai.provider) throw new HttpError(503, 'AI is not configured on this server. Set ANTHROPIC_API_KEY to enable it.');

    const client = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const quota = rateLimit(client);
    if (!quota.allowed) throw new HttpError(429, 'Too many requests. Try again in a few minutes.');

    const body = await readJson(req);
    if (pathname === '/api/match') {
      const cv = text(body.cv, LIMITS.text, 'cv'), jd = text(body.jd, LIMITS.text, 'jd');
      return send(res, 200, await ai.match({ cv, jd }));
    }
    if (pathname === '/api/suggestions') {
      const cv = text(body.cv, LIMITS.text, 'cv'), draft = text(body.draft, LIMITS.text, 'draft'), jd = text(body.jd, LIMITS.text, 'jd', { required: false });
      return send(res, 200, await ai.suggest({ cv, draft, jd, requirements: reqList(body.requirements) }));
    }
    if (pathname === '/api/questions') {
      const cv = text(body.cv, LIMITS.text, 'cv'), jd = text(body.jd, LIMITS.text, 'jd');
      const level = ['screening', 'technical', 'senior'].includes(body.level) ? body.level : 'technical';
      const count = [5, 10, 25].includes(Number(body.count)) ? Number(body.count) : 5;
      return send(res, 200, await ai.questions({ cv, jd, requirements: reqList(body.requirements), level, count }));
    }
    if (pathname === '/api/gap-questions') {
      const cv = text(body.cv, LIMITS.text, 'cv'), jd = text(body.jd, LIMITS.text, 'jd', { required: false });
      const requirement = { name: text(body.requirement?.name, 80, 'requirement.name'), source: text(body.requirement?.source, 400, 'requirement.source', { required: false }) };
      return send(res, 200, await ai.gapQuestions({ cv, jd, requirement }));
    }
    if (pathname === '/api/gap-bullet') {
      const cv = text(body.cv, LIMITS.text, 'cv');
      const requirement = { name: text(body.requirement?.name, 80, 'requirement.name') };
      const questions = (Array.isArray(body.questions) ? body.questions : []).slice(0, 4).map((q) => text(q, LIMITS.question, 'question'));
      const answers = (Array.isArray(body.answers) ? body.answers : []).slice(0, 4).map((a) => text(a, 2000, 'answer', { required: false }));
      if (!questions.length || !answers.some((a) => /^yes\b/i.test(a.trim()) || a.trim().length >= 10)) throw new HttpError(400, 'Answer Yes to at least one question, or add a sentence of detail.');
      const otherGaps = reqList(body.otherGaps).map((r) => r.name);
      return send(res, 200, await ai.gapBullet({ cv, requirement, questions, answers, otherGaps, finalRound: body.finalRound === true }));
    }
    if (pathname === '/api/scan-summary') {
      const cv = text(body.cv, LIMITS.text, 'cv');
      const scan = body.scan;
      if (!scan || typeof scan.score !== 'number' || !scan.parts?.coverage) throw new HttpError(400, 'scan result is required');
      return send(res, 200, await ai.scanSummary({ cv, scan }));
    }
    if (pathname === '/api/structure') {
      const cv = text(body.cv, LIMITS.text, 'cv');
      return send(res, 200, await ai.structure({ cv }));
    }
    if (pathname === '/api/feedback') {
      const question = text(body.question, LIMITS.question, 'question'), answer = text(body.answer, LIMITS.answer, 'answer'), cv = text(body.cv, LIMITS.text, 'cv', { required: false });
      if (answer.trim().split(/\s+/).length < 8) throw new HttpError(400, 'Write a few sentences before requesting a review.');
      return send(res, 200, await ai.feedback({ question, answer, cv }));
    }
    throw new HttpError(404, 'Unknown endpoint');
  }

  async function staticFile(req, res, pathname) {
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try {
      const data = await readFile(file);
      const type = MIME[extname(file)] || 'application/octet-stream';
      const headers = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
      if (type.startsWith('text/html')) headers['Content-Security-Policy'] = CSP;
      // App modules must revalidate on every load so a deploy never leaves a browser running stale JS
      // against new HTML; only the pinned vendor parsers are safe to cache.
      headers['Cache-Control'] = file.includes(`${sep}vendor${sep}`) ? 'public, max-age=86400' : 'no-cache';
      res.writeHead(200, headers).end(data);
    } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); }
  }

  return async (req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
    if (!pathname.startsWith('/api/')) return staticFile(req, res, pathname);
    try {
      await api(req, res, pathname);
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) log.error(`[api] ${req.method} ${pathname} -> ${status}: ${error.message}`); // message only, never bodies
      send(res, status, { error: status >= 500 && !error.status ? 'Something went wrong on the server.' : error.message });
    }
  };
}
