// Client for the Roledone server API. Consent is checked before any CV text leaves the browser.

import { state, session, save } from './state.js';
import { modal, closeModal, $ } from './ui.js';

async function request(path, body) {
  let res;
  try {
    res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  } catch {
    throw new Error('Could not reach the Roledone server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function loadStatus() {
  try { session.ai = await request('/api/status'); } catch { session.ai = { ai: false, provider: null, model: null }; }
  return session.ai;
}

export const aiAvailable = () => Boolean(session.ai?.ai);
export const providerLabel = () => (session.ai?.provider === 'anthropic' ? 'AI agent' : session.ai?.provider === 'mock' ? 'mock provider' : 'AI');
/** Processor named in the consent dialog. The privacy policy, not the UI, names the underlying model vendor. */
export const processorName = () => (session.ai?.provider === 'anthropic' ? 'our AI provider' : providerLabel());

/** Ask once per workspace before sending CV text to the server. Resolves false if declined. */
export function ensureConsent() {
  if (state.aiConsent) return Promise.resolve(true);
  return new Promise((resolve) => {
    modal(`<div class="eyebrow">BEFORE WE CONTINUE</div><h2>Send your text for analysis?</h2>
<p>Your CV and job description text will be sent to the Roledone server and processed by ${processorName()} to produce this result. Roledone does not store your documents; the provider processes them only to produce the result, under the terms in our privacy policy.</p>
<p>Review every suggestion. The AI can only quote and rephrase what you wrote — it is blocked from adding numbers, tools or claims that are not already in your CV.</p>
<label class="field"><span><input type="checkbox" id="consent-remember" checked> Don’t ask again in this workspace</span></label>
<div class="actions"><button class="primary" id="consent-yes">Continue</button><button class="secondary" id="consent-no">Not now</button></div>`);
    const dialog = $('#dialog');
    const finish = (value) => { dialog.removeEventListener('close', onClose); resolve(value); };
    const onClose = () => finish(false);
    dialog.addEventListener('close', onClose);
    $('#consent-yes').onclick = () => { if ($('#consent-remember').checked) { state.aiConsent = true; save(); } closeModal(); finish(true); };
    $('#consent-no').onclick = () => { closeModal(); finish(false); };
  });
}

export const match = (cv, jd) => request('/api/match', { cv, jd });
export const suggestions = ({ cv, draft, jd, requirements }) => request('/api/suggestions', { cv, draft, jd, requirements: requirements.map((r) => ({ name: r.name, status: r.status })) });
export const feedback = ({ question, answer, cv }) => request('/api/feedback', { question, answer, cv });
export const questions = ({ cv, jd, requirements, level, count }) => request('/api/questions', { cv, jd, requirements: requirements.map((r) => ({ name: r.name, status: r.status })), level, count });
export const gapQuestions = ({ cv, jd, requirement }) => request('/api/gap-questions', { cv, jd, requirement: { name: requirement.name, source: requirement.source || '' } });
export const gapBullet = ({ cv, requirement, questions, answers, otherGaps }) => request('/api/gap-bullet', { cv, requirement: { name: requirement.name }, questions, answers, otherGaps: otherGaps.map((r) => ({ name: r.name, status: r.status })) });
export const scanSummary = ({ cv, scan }) => request('/api/scan-summary', { cv, scan });

/**
 * Write the interview set for the current role in the background and store it.
 * Safe to call repeatedly: a run already in flight is reused. Resolves to the questions or null.
 */
export function generateQuestions({ level, count, force = false } = {}) {
  if (!aiAvailable() || !state.cv || !state.jd) return Promise.resolve(null);
  if (!force && state.questions?.length) return Promise.resolve(state.questions);
  if (session.questionsPending) return session.questionsPending;
  const lvl = level || state.questionLevel || 'technical', n = count || Number(state.questionCount) || 5;
  const reqs = (state.requirements || []).map((r) => ({ name: r.name, status: r.status }));
  session.questionsPending = questions({ cv: state.cv, jd: state.jd, requirements: reqs, level: lvl, count: n })
    .then((result) => {
      if (!result.questions?.length) return null;
      state.questions = result.questions; state.questionLevel = lvl; state.questionCount = n; state.answers = {}; state.feedback = {}; session.question = 0; save();
      return state.questions;
    })
    .catch(() => null)
    .finally(() => { session.questionsPending = null; });
  return session.questionsPending;
}
