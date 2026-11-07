// Workspace state. In-memory by default; persisted to localStorage only when the user opts in.

import { analyse } from './core.js';

const KEY = 'roledone-v1';
const LEGACY_KEYS = ['rolewoven-v2', 'rolewoven-v1']; // pre-rename workspaces are migrated on first load

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
  plan: null,           // null = server default (ROLEDONE_DEFAULT_PLAN); developer preview until accounts exist
  questions: null,      // AI-written interview questions for this role
  questionLevel: 'technical',
  questionCount: 5,
  gaps: {},             // requirement id -> { questions, answers, result } from the Gap Interview
  template: 'standard', // chosen CV template
  structured: null,     // { hash, cv } structured form of the draft used by templates
  scan: null,           // CV-only scan result
  scanSummary: null,    // Claude's read of the scan
  followUps: {},        // question index -> [{ question, answer, feedback }] (Premium)
  mock: null,           // timed mock session in progress or finished (Premium)
  versions: [],         // saved CV drafts: [{ id, name, role, draft, at }] (Premium)
});

export const state = blank();
export const session = { page: 'overview', question: 0, isSample: false, questionsPending: null /* Promise while a set is being written */, ai: { ai: false, provider: null, model: null }, sourceDoc: null /* {name, bytes} of the uploaded .docx */, me: null /* signed-in user */ };

// The uploaded .docx (binary) lives in IndexedDB when device saving is on; localStorage is text-only.
const DB = 'roledone', STORE = 'files';
function withStore(mode, fn) {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onerror = () => resolve(undefined);
      open.onsuccess = () => { try { const tx = open.result.transaction(STORE, mode); const req = fn(tx.objectStore(STORE)); tx.oncomplete = () => resolve(req?.result); tx.onerror = () => resolve(undefined); } catch { resolve(undefined); } };
    } catch { resolve(undefined); }
  });
}
export async function loadSourceDoc() { const doc = await withStore('readonly', (s) => s.get('sourceDoc')); if (doc?.bytes && state.remember) session.sourceDoc = doc; }
export function setSourceDoc(doc) { session.sourceDoc = doc || null; if (state.remember) withStore('readwrite', (s) => (doc ? s.put(doc, 'sourceDoc') : s.delete('sourceDoc'))); }

let onStorageError = () => {};
export function setStorageErrorHandler(fn) { onStorageError = fn; }

const STASH = 'roledone-stash'; // survives a same-tab round trip (e.g. Stripe Checkout) without device saving
export function stash() { try { sessionStorage.setItem(STASH, JSON.stringify(state)); } catch { /* ignore */ } }

export function load() {
  try {
    const stashed = sessionStorage.getItem(STASH);
    if (stashed) {
      sessionStorage.removeItem(STASH);
      const saved = JSON.parse(stashed);
      if (saved && typeof saved.cv === 'string') { Object.assign(state, blank(), saved); if (state.remember) save(); return; }
    }
  } catch { /* fall through to normal load */ }
  try {
    const raw = localStorage.getItem(KEY) || LEGACY_KEYS.map((k) => localStorage.getItem(k)).find(Boolean);
    const saved = JSON.parse(raw || 'null');
    if (saved && typeof saved.cv === 'string' && typeof saved.jd === 'string' && Array.isArray(saved.applications)) {
      Object.assign(state, blank(), saved, { remember: true });
      if (raw && !localStorage.getItem(KEY)) { localStorage.setItem(KEY, JSON.stringify(state)); LEGACY_KEYS.forEach((k) => localStorage.removeItem(k)); }
    }
  } catch { /* storage unavailable or corrupt: start fresh */ }
}

export function save() {
  if (!state.remember) return;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { onStorageError(); }
  if (session.sourceDoc) withStore('readwrite', (s) => s.put(session.sourceDoc, 'sourceDoc'));
}

export function forget() {
  try { localStorage.removeItem(KEY); LEGACY_KEYS.forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
  withStore('readwrite', (s) => s.delete('sourceDoc'));
}

export function reset() {
  forget();
  session.sourceDoc = null;
  Object.assign(state, blank());
  session.isSample = false;
  session.question = 0;
}

/** Replace the CV and/or JD; anything derived from them is invalidated. */
export function setSources({ cv = state.cv, jd = state.jd, sourceDoc }) {
  const cvChanged = cv !== state.cv, jdChanged = jd !== state.jd;
  state.cv = cv;
  state.jd = jd;
  if (cvChanged) {
    setSourceDoc(sourceDoc || null); // a pasted or re-uploaded CV no longer matches the old file
    state.draft = null; state.suggestions = null; state.dismissed = []; state.applied = []; state.scan = null; state.scanSummary = null; state.structured = null;
  }
  if (cvChanged || jdChanged) { state.answers = {}; state.feedback = {}; state.followUps = {}; state.mock = null; state.requirements = null; state.matchMeta = null; state.questions = null; state.gaps = {}; session.question = 0; }
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
