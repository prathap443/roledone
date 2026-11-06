// Roledone app shell: routing, navigation, workspace settings, and the AI status indicator.
// Pages live in ./pages/*.js; shared state in ./state.js; server calls in ./api.js.

import { sampleCV, sampleJD } from './core.js';
import { state, session, load, save, reset, forget, setSources, setStorageErrorHandler, loadSourceDoc, stash } from './state.js';
import { $, $$, esc, toast, modal, closeModal, confirm, download } from './ui.js';
import { loadStatus, loadBilling, aiAvailable, providerLabel, billingEnabled, startCheckout, confirmCheckout, portal, setToken } from './api.js';
import { PLANS, COMPARISON, plan } from './plans.js';
import * as overview from './pages/overview.js';
import * as scan from './pages/scan.js';
import * as match from './pages/match.js';
import * as editor from './pages/editor.js';
import * as interview from './pages/interview.js';
import * as applications from './pages/applications.js';
import * as templates from './pages/templates.js';

const pages = { overview, scan, match, editor, interview, applications, templates };
const names = { overview: 'Overview', scan: 'CV scan', match: 'Role match', editor: 'CV studio', templates: 'Templates', interview: 'Interview room', applications: 'Applications' };

setStorageErrorHandler(() => toast('Storage is unavailable. Your work remains in this tab.'));
load();

function navigate(next) {
  session.page = names[next] ? next : 'overview';
  location.hash = session.page;
  render();
  window.scrollTo(0, 0);
}

/** Attach page-navigation handlers to any [data-page] buttons inside `root`. */
function rebind(root = document) {
  const scope = typeof root === 'string' ? $(root) : root;
  $$('[data-page]', scope).forEach((b) => (b.onclick = () => navigate(b.dataset.page)));
  $$('[data-upgrade]', scope).forEach((b) => (b.onclick = showPlans));
}

const SELLABLE = ['pro']; // Premium goes on sale once its features exist

function showPlans() {
  const current = plan();
  const live = billingEnabled();
  const subscribed = Boolean(session.billing?.subscribed);
  const available = session.ai?.plans || [];
  const cta = (k) => {
    if (k === 'free') return '';
    if (subscribed && session.billing.plan === k) return '<span class="pill">Your plan</span>';
    if (!live || !available.includes(k) || !SELLABLE.includes(k)) return '<span class="hint">Coming soon</span>';
    return `<button class="primary small" data-checkout="${k}">Choose ${PLANS[k].label}</button>`;
  };
  modal(`<div class="eyebrow">PLANS</div><h2>See where you stand for free. Pay to close the gap.</h2>
<p>Free scans a role and shows your Evidence Score and every missing requirement. Pro and Premium turn that into a stronger CV and a prepared interview.</p>
<table class="plan-table"><thead><tr><th></th>${Object.entries(PLANS).map(([k, p]) => `<th class="${k === current ? 'current' : ''}">${p.label}<small>${p.price}</small></th>`).join('')}</tr></thead>
<tbody>${COMPARISON.map(([f, ...cols]) => `<tr><td>${f}</td>${cols.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}
<tr class="cta-row"><td></td>${Object.keys(PLANS).map((k) => `<td>${cta(k)}</td>`).join('')}</tr></tbody></table>
${live ? `<label class="field">Email for your receipt<input type="email" id="checkout-email" placeholder="you@example.com" autocomplete="email"></label>
<p class="hint">Secure checkout by Stripe. Cancel any time from workspace settings. Your subscription is remembered on this device${subscribed ? '' : '; sign-in across devices is coming'}.</p>` : `<p class="hint">Payments are not live yet. You are on the <strong>${PLANS[current].label}</strong> plan${current === 'free' ? '' : ' (developer preview)'}.</p>`}`);
  $$('[data-checkout]').forEach((b) => (b.onclick = async () => {
    const email = $('#checkout-email')?.value.trim();
    b.disabled = true; b.textContent = 'Opening checkout…';
    try { const { url } = await startCheckout(b.dataset.checkout, email); stash(); location.href = url; }
    catch (error) { toast(error.message); b.disabled = false; b.textContent = `Choose ${PLANS[b.dataset.checkout].label}`; }
  }));
}

/** Returning from Stripe Checkout: confirm the session server-side and store the entitlement token. */
async function handleCheckoutReturn() {
  const url = new URL(location.href);
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId) return;
  url.searchParams.delete('session_id'); history.replaceState(null, '', url.pathname + url.hash);
  try {
    const res = await confirmCheckout(sessionId);
    setToken(res.token);
    await loadBilling();
    render(); renderStatus();
    modal(`<div class="eyebrow">WELCOME TO ${esc(PLANS[res.plan].label.toUpperCase())}</div><h2>You’re set.</h2><p>Everything is unlocked on this device${res.email ? `; Stripe has emailed a receipt to ${esc(res.email)}` : ''}. Manage or cancel any time from workspace settings.</p><div class="actions"><button class="primary" id="welcome-ok">Start with a role match</button></div>`);
    $('#welcome-ok').onclick = () => { closeModal(); navigate('match'); };
  } catch (error) {
    toast(`Payment received but activation failed: ${error.message}. Reload this page; if it persists, contact support with your receipt.`);
  }
}

function render() {
  $('#breadcrumb').innerHTML = `Workspace <b>/ ${names[session.page]}</b>`;
  $$('nav button').forEach((b) => {
    const active = b.dataset.page === session.page || (session.page === 'templates' && b.dataset.page === 'editor');
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#main').innerHTML = pages[session.page].render();
  rebind();
  pages[session.page].bind({ loadSample, rebind, render });
}

function renderStatus() {
  const dot = $('.status-dot'), label = $('.top-status');
  dot.classList.toggle('on', aiAvailable());
  label.textContent = aiAvailable() ? `${providerLabel()} connected` : 'Browser-only prototype';
  label.title = aiAvailable() ? `AI analysis via ${session.ai.provider} (${session.ai.model}). Text is only sent when you ask.` : 'No AI provider configured on this server.';
  $('.profile small').textContent = session.billing?.subscribed ? `${PLANS[session.billing.plan]?.label || 'Paid'} plan` : aiAvailable() ? 'AI-assisted workspace' : 'Local prototype';
}

async function loadSample() {
  if (state.cv || state.jd) {
    const ok = await confirm({ title: 'Load the sample journey?', body: 'This replaces your current CV, job description, draft, and practice answers. Tracked applications stay in place.', action: 'Load sample' });
    if (!ok) return;
  }
  setSources({ cv: sampleCV, jd: sampleJD });
  session.isSample = true;
  navigate('match');
  toast('Fictional sample loaded. Try the comparison.');
}

$('#help').onclick = () => modal(`<div class="eyebrow">ROLEDONE / EARLY ACCESS</div><h2>Real experience. A clearer story.</h2>
<p>Match a role, edit your CV, practise interview answers, and track applications.</p>
<p>${aiAvailable()
    ? `AI analysis is provided by ${esc(providerLabel())}. It reads your text only when you press an AI button, must quote your own CV for every claim, and is blocked from inventing numbers, tools, or achievements. Roledone does not store your documents.`
    : 'No AI provider is configured on this server, so matching and feedback use simple local rules.'}</p>
<p>Import PDF, DOCX, or TXT files up to 10 MB; export edited CVs as TXT. Scanned PDFs need OCR first. Your content stays in this tab unless you enable device saving.</p>`);

$('#settings').onclick = () => {
  modal(`<h2>Your workspace, your choice.</h2>
<p>Device saving stores CV text, drafts, answers, and applications in this browser’s local storage. This is not an encrypted document vault. Use a trusted device.</p>
<label class="field"><span><input type="checkbox" id="remember" ${state.remember ? 'checked' : ''}> Save my workspace on this device</span></label>
${aiAvailable() ? `<label class="field"><span><input type="checkbox" id="consent" ${state.aiConsent ? 'checked' : ''}> Send text to ${esc(providerLabel())} without asking each time</span></label>` : ''}
${session.billing?.subscribed ? `<p><strong>${esc(PLANS[session.billing.plan]?.label || 'Paid')} plan</strong> on this device${session.billing.renews ? ` · renews ${new Date(session.billing.renews).toLocaleDateString('en-GB')}` : ''}.</p><div class="actions"><button class="secondary" id="manage-sub">Manage or cancel subscription ↗</button></div>` : billingEnabled() ? `<div class="actions"><button class="secondary" data-upgrade>See plans ↗</button></div>` : ''}
<label class="field inline">Plan (developer preview${billingEnabled() ? ', ignored once subscribed' : ' — not enforced until accounts exist'})<select id="plan"><option value="" ${state.plan == null ? 'selected' : ''}>Server default (${PLANS[plan()].label})</option>${Object.entries(PLANS).map(([k, p]) => `<option value="${k}" ${state.plan === k ? 'selected' : ''}>${p.label} · ${p.price}</option>`).join('')}</select></label>
<div class="actions"><button class="secondary" id="export-workspace">Export workspace</button><button class="secondary" id="clear-workspace">Clear all workspace data</button></div>`);
  $('#remember').onchange = (e) => { state.remember = e.target.checked; if (!state.remember) forget(); save(); toast(state.remember ? 'Device saving enabled.' : 'Device saving disabled.'); };
  $('#consent') && ($('#consent').onchange = (e) => { state.aiConsent = e.target.checked; save(); });
  $('#plan').onchange = (e) => { state.plan = e.target.value || null; save(); render(); toast(`${PLANS[plan()].label} plan (preview).`); };
  $$('[data-upgrade]', $('#dialog')).forEach((b) => (b.onclick = showPlans));
  $('#manage-sub')?.addEventListener('click', async (e) => { const button = e.currentTarget; button.disabled = true; try { const { url } = await portal(); stash(); location.href = url; } catch (error) { toast(error.message); button.disabled = false; } });
  $('#export-workspace').onclick = () => download('roledone-workspace.json', JSON.stringify(state, null, 2), 'application/json');
  $('#clear-workspace').onclick = async () => {
    closeModal();
    if (await confirm({ title: 'Clear all workspace data?', body: 'This removes the CV, draft, practice answers, suggestions, and application records from this tab and this browser’s saved workspace. Export a copy first if needed.', action: 'Clear everything' })) {
      reset(); navigate('overview'); toast('Workspace cleared.');
    }
  };
};
$('#mobile-settings').onclick = () => $('#settings').click();

document.addEventListener('roledone:upgrade', showPlans);

window.addEventListener('hashchange', () => {
  const next = location.hash.slice(1);
  if (next !== session.page) { session.page = names[next] ? next : 'overview'; render(); }
});

session.page = names[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
render();
loadStatus().then(async (status) => { await loadBilling(); renderStatus(); if (status.ai || session.billing?.subscribed) render(); await handleCheckoutReturn(); });
loadSourceDoc().then(() => { if (session.sourceDoc && session.page === 'editor') render(); });
