// Plan definitions and feature gates.
// Until accounts exist the active plan lives in workspace state (developer preview only);
// the server will enforce entitlements once authentication lands.

import { state, session } from './state.js';

export const PLANS = {
  free: { label: 'Free', price: '£0', blurb: 'See where you stand.' },
  pro: { label: 'Pro', price: '£9.99 / month', blurb: 'Close the gaps and get ready.' },
  premium: { label: 'Premium', price: '£24.99 / month', blurb: 'Every application, fully prepared.' },
};

const RANK = { free: 0, pro: 1, premium: 2 };

/** Minimum plan for each feature. Anything not listed is free. */
export const FEATURES = {
  suggestions: 'pro',
  gapInterview: 'pro',
  editor: 'pro',
  export: 'pro',
  questions: 'pro',
  feedback: 'pro',
  regenerate: 'pro',
  followUps: 'premium',
  versions: 'premium',
  exportDocx: 'premium',
};

export const plan = () => (RANK[state.plan] !== undefined ? state.plan : RANK[session.ai?.defaultPlan] !== undefined ? session.ai.defaultPlan : 'free');
export const can = (feature) => RANK[plan()] >= RANK[FEATURES[feature] || 'free'];
export const needs = (feature) => PLANS[FEATURES[feature] || 'free'].label;

/** Comparison rows for the upgrade dialog. */
export const COMPARISON = [
  ['Role scans and Evidence Score', '3 / month', 'Unlimited', 'Unlimited'],
  ['Requirement list with what is missing', '✓', '✓', '✓'],
  ['CV suggestions you can apply', '—', 'Unlimited', 'Unlimited'],
  ['Gap Interview → new bullets from your answers', '—', '✓', '✓'],
  ['CV studio and TXT export', '—', '✓', '✓'],
  ['Interview questions written for this role', '—', 'Unlimited', 'Unlimited'],
  ['Answer review (STAR)', '—', '✓', '✓'],
  ['Follow-up questions and mock session', '—', '—', '✓'],
  ['Multiple CV versions, DOCX / PDF export', '—', '—', '✓'],
];
