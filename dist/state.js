// Workspace state. In-memory by default; persisted to localStorage only when the user opts in.

import { analyse } from './core.js';

const KEY = 'rolewoven-v2';
const LEGACY_KEY = 'rolewoven-v1';

export const blank = () => ({
  cv: '',
  jd: '',
  draft: null,
  answers: {},
  feedback: {},
  applications: [],
  remember: false,
  aiConsent: false,
  requirements: null,   // AI match result, or null when only the local text check has run
  matchMeta: null,
  suggestions: null,    // AI suggestions for the current draft, or null
  dismissed: [],
  applied: [],
  plan: 'free',         // developer preview until accounts exist
  questions: null,      // AI-written interview questions for this role
  questionLevel: 'technical',
  gaps: {},             // requirement id -> { questions, answers, result } from the Gap Interview
});

export const state = blank();
export const session = { page: 'overview', question: 0, isSample: false, ai: { ai: false, provider: null, model: null } };

let onStorageError = () => {};
export function setStorageErrorHandler(fn) { onStorageError = fn; }

export function load() {
  try {
    const raw = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY);
    const saved = JSON.parse(raw || 'null');
    if (saved && typeof saved.cv === 'string' && typeof saved.jd === 'string' && Array.isArray(saved.applications)) {
      Object.assign(state, blank(), saved, { remember: true });
      if (raw && !localStorage.getItem(KEY)) { localStorage.setItem(KEY, JSON.stringify(state)); localStorage.removeItem(LEGACY_KEY); }
    }
  } catch { /* storage unavailable or corrupt: start fresh */ }
}

export function save() {
  if (!state.remember) return;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { onStorageError(); }
}

export function forget() {
  try { localStorage.removeItem(KEY); localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
}

export function reset() {
  forget();
  Object.assign(state, blank());
  session.isSample = false;
  session.question = 0;
}

/** Replace the CV and/or JD; anything derived from them is invalidated. */
export function setSources({ cv = state.cv, jd = state.jd }) {
  const cvChanged = cv !== state.cv, jdChanged = jd !== state.jd;
  state.cv = cv;
  state.jd = jd;
  if (cvChanged) { state.draft = null; state.suggestions = null; state.dismissed = []; state.applied = []; }
  if (cvChanged || jdChanged) { state.answers = {}; state.feedback = {}; state.requirements = null; state.matchMeta = null; state.questions = null; state.gaps = {}; session.question = 0; }
  save();
}

export function setDraft(draft) {
  state.draft = draft;
  save();
}

/** Requirements to display: the AI result when present, otherwise the local text check in the same shape. */
export function requirements() {
  if (state.requirements) return state.requirements;
  return analyse(state.cv, state.jd).map((r, i) => ({ id: `l${i + 1}`, name: r.name, kind: 'must', source: null, evidence: r.evidence, status: r.evidence ? 'evidence' : 'gap', note: '' }));
}

export const currentDraft = () => state.draft ?? state.cv;
