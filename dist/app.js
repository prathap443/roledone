// Roledone app shell: routing, navigation, workspace settings, and the AI status indicator.
// Pages live in ./pages/*.js; shared state in ./state.js; server calls in ./api.js.

import { sampleCV, sampleJD } from './core.js';
import { state, session, load, save, reset, forget, setSources, setStorageErrorHandler, loadSourceDoc, stash } from './state.js';
import { $, $$, esc, toast, modal, closeModal, confirm, download } from './ui.js';
import { loadStatus, loadBilling, aiAvailable, providerLabel, billingEnabled, authEnabled, startCheckout, confirmCheckout, portal, setToken, getToken, attachDeviceSubscription, usageReport } from './api.js';
import { sendMagicLink, signInWithGoogle, captureSessionFromUrl, signOut, currentUser } from './auth.js';
import { PLANS, COMPARISON, plan, previewing, grantedPlan } from './plans.js';
import * as overview from './pages/overview.js';
import * as scan from './pages/scan.js';
import * as match from './pages/match.js';
import * as editor from './pages/editor.js';
import * as interview from './pages/interview.js';
import * as applications from './pages/applications.js';
import * as templates from './pages/templates.js';
import * as jobs from './pages/jobs.js';

const pages = { overview, scan, match, editor, interview, applications, templates, jobs };
const names = { overview: 'Overview', scan: 'CV scan', match: 'Role match', editor: 'CV studio', templates: 'Templates', interview: 'Interview room', applications: 'Applications', jobs: 'Jobs' };

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

const SELLABLE = ['pro', 'premium'];

function showPlans({ quota = null } = {}) {
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
  modal(`<div class="eyebrow">PLANS</div>${quota ? `<div class="quota-note"><strong>${quota.used} of ${quota.limit}</strong> ${quota.feature === 'match' ? 'role matches' : 'suggestion runs'} used this month on ${esc(PLANS[quota.plan]?.label || 'your')} plan. Your allowance resets on the 1st${quota.plan === 'free' ? ' — or upgrade now and keep going.' : '.'}</div>` : ''}<h2>See where you stand for free. Pay to close the gap.</h2>
<p>Free scans a role and shows your Evidence Score and every missing requirement. Pro and Premium turn that into a stronger CV and a prepared interview.</p>
<table class="plan-table"><thead><tr><th></th>${Object.entries(PLANS).map(([k, p]) => `<th class="${k === current ? 'current' : ''}">${p.label}<small>${p.price}</small></th>`).join('')}</tr></thead>
<tbody>${COMPARISON.map(([f, ...cols]) => `<tr><td>${f}</td>${cols.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}
<tr class="cta-row"><td></td>${Object.keys(PLANS).map((k) => `<td>${cta(k)}</td>`).join('')}</tr></tbody></table>
${live ? `${authEnabled() ? (currentUser() ? `<p class="hint">Receipts go to <strong>${esc(currentUser().email)}</strong>.</p>` : '<p class="hint">You will be asked to sign in before checkout so your plan works on every device.</p>') : '<label class="field">Email for your receipt<input type="email" id="checkout-email" placeholder="you@example.com" autocomplete="email"></label>'}
<p class="hint">Secure checkout by Stripe. Cancel any time from Plan &amp; billing.${authEnabled() ? '' : ' Your subscription is remembered on this device.'}</p>` : `<p class="hint">Payments are not live yet. You are on the <strong>${PLANS[current].label}</strong> plan${current === 'free' ? '' : ' (developer preview)'}.</p>`}`);
  $$('[data-checkout]').forEach((b) => (b.onclick = async () => {
    if (authEnabled() && !currentUser()) { showSignIn({ reason: 'Sign in first so your subscription is attached to your account and works on every device.', after: 'checkout' }); return; }
    const email = $('#checkout-email')?.value.trim();
    b.disabled = true; b.textContent = 'Opening checkout…';
    try { const { url } = await startCheckout(b.dataset.checkout, email); stash(); location.href = url; }
    catch (error) { toast(error.message); b.disabled = false; b.textContent = `Choose ${PLANS[b.dataset.checkout].label}`; }
  }));
}

/** Sign in: magic link or Google. `after` runs once signed in (e.g. continue to checkout). */
function showSignIn({ reason = '', after = null } = {}) {
  modal(`<div class="eyebrow">SIGN IN</div><h2>No password. Just your email.</h2>
<p>${esc(reason || 'Sign in to keep your subscription on every device and pick up where you left off.')}</p>
<form id="magic-form"><label class="field">Email<input type="email" id="magic-email" placeholder="you@example.com" autocomplete="email" required></label>
<div class="actions"><button class="primary" type="submit">Email me a sign-in link</button><button class="secondary" type="button" id="google-signin"><span class="g">G</span> Continue with Google</button></div></form>
<p class="hint">We only use your email to sign you in and send receipts. No newsletters.</p>`);
  sessionStorage.setItem('roledone-after-signin', after || '');
  $('#magic-form').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#magic-email').value.trim(), button = e.submitter;
    button.disabled = true; button.textContent = 'Sending…';
    try {
      stash();
      await sendMagicLink(email);
      $('#dialog-content').innerHTML = `<div class="eyebrow">CHECK YOUR EMAIL</div><h2>Link sent to ${esc(email)}.</h2><p>Open it on this device to finish signing in. It works once and expires in an hour. Nothing in your inbox? Check spam, or wait a minute and try again.</p><div class="actions"><button class="secondary" id="signin-done">Close</button></div>`;
      $('#signin-done').onclick = closeModal;
    } catch (error) { toast(error.message); button.disabled = false; button.textContent = 'Email me a sign-in link'; }
  };
  $('#google-signin').onclick = () => { try { stash(); signInWithGoogle(); } catch (error) { toast(error.message); } };
}
$('#signin').onclick = () => (currentUser() ? showAccount() : showSignIn());

function showAccount() {
  const u = currentUser();
  modal(`<div class="eyebrow">ACCOUNT</div><h2>${esc(u?.email || 'Signed in')}</h2><p>Your subscription and, soon, your saved CVs follow this account on any device.</p>
<div class="actions"><button class="secondary" data-billing>Plan &amp; billing</button><button class="text-button" id="signout">Sign out</button></div>`);
  $('[data-billing]', $('#dialog')).onclick = showBilling;
  $('#signout').onclick = async () => { await signOut(); await loadBilling(); closeModal(); renderStatus(); render(); toast('Signed out.'); };
}

/** After sign-in: attach any subscription bought on this device before accounts existed, then continue. */
async function afterSignIn() {
  if (getToken()) { try { const r = await attachDeviceSubscription(); if (r.attached) { setToken(''); toast(`Your ${PLANS[r.plan]?.label || 'paid'} subscription is now on your account.`); } } catch { /* nothing to attach or already attached */ } }
  await loadBilling(); renderStatus(); render();
  const next = sessionStorage.getItem('roledone-after-signin'); sessionStorage.removeItem('roledone-after-signin');
  if (next === 'checkout') showPlans(); else toast(`Signed in as ${currentUser()?.email || 'you'}.`);
}

/** Plan & billing: the one place a customer looks for their subscription. */
function showBilling() {
  const b = session.billing || {};
  const current = plan();
  const renews = b.renews ? new Date(b.renews).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  const statusLine = b.admin ? 'Admin account: every feature is unlocked without a subscription.' : b.subscribed
    ? (b.status === 'past_due' ? 'Last payment failed — update your card to keep access.' : b.status === 'canceled' ? 'Cancelled. Access continues until the end of the period.' : renews ? `Renews on ${renews}.` : 'Active.')
    : billingEnabled() ? 'You are on the Free plan: scan, score and see what is missing.' : 'Payments are not live yet.';
  modal(`<div class="eyebrow">PLAN &amp; BILLING</div>
${previewing() ? `<div class="quota-note">You are <strong>previewing the ${esc(PLANS[plan()].label)} plan</strong> (developer setting). Your real access is ${esc(PLANS[grantedPlan()].label)}. <button class="text-button" id="exit-preview">Exit preview</button></div>` : ''}
<h2>${b.subscribed ? `${esc(PLANS[b.plan]?.label || 'Paid')} plan` : `${esc(PLANS[current].label)} plan`}</h2>
<p>${esc(statusLine)}</p>
${b.subscribed ? `${b.source === 'device' ? (authEnabled() ? `<p class="hint">This subscription is tied to this browser. <button class="text-button" id="attach-now">Sign in to attach it to your account</button> so it works everywhere.</p>` : '<p class="hint">Your subscription is tied to this browser. Clearing site data or switching device loses access; keep your Stripe receipt.</p>') : `<p class="hint">On your account${currentUser()?.email ? ` (${esc(currentUser().email)})` : ''} — works on any device you sign in to.</p>`}
<div class="actions"><button class="primary" id="manage-sub">Manage, change card or cancel ↗</button><button class="secondary" data-upgrade>Compare plans</button></div>`
  : `<div class="actions"><button class="primary lime" data-upgrade>See plans and upgrade ↗</button></div>`}
${!b.subscribed && current !== 'free' ? `<p class="hint">You currently have ${esc(PLANS[current].label)} access through a server default${state.plan ? ' / developer preview' : ''}.</p>` : ''}
${quotaHtml(b.quota)}${b.admin ? '<details class="developer" id="usage-panel"><summary>Usage &amp; cost this month (admin)</summary><div id="usage-body"><p class="hint">Loading…</p></div></details>' : ''}`);
  $('#usage-panel')?.addEventListener('toggle', async (e) => { if (!e.currentTarget.open) return; try { $('#usage-body').innerHTML = usageHtml(await usageReport()); } catch (error) { $('#usage-body').innerHTML = `<p class="hint">${esc(error.message)}</p>`; } });
  $$('[data-upgrade]', $('#dialog')).forEach((x) => (x.onclick = showPlans));
  $('#exit-preview')?.addEventListener('click', () => { state.plan = null; save(); closeModal(); render(); renderStatus(); toast('Preview off — full access restored.'); });
  $('#attach-now')?.addEventListener('click', () => (currentUser() ? afterSignIn() : showSignIn({ reason: 'Sign in to attach the subscription on this device to your account.' })));
  $('#manage-sub')?.addEventListener('click', async (e) => { const button = e.currentTarget; button.disabled = true; try { const { url } = await portal(); stash(); location.href = url; } catch (error) { toast(error.message); button.disabled = false; } });
}
const FEATURE_LABEL = { match: 'Role matches', suggestions: 'CV suggestion runs' };
function quotaHtml(q) {
  if (!q?.features) return '';
  const rows = Object.entries(q.features).filter(([f]) => FEATURE_LABEL[f]).map(([f, v]) => {
    const pct = v.limit ? Math.min(100, Math.round(100 * v.used / v.limit)) : 0;
    return `<div class="quota-row"><span>${FEATURE_LABEL[f]}</span><span class="quota-bar"><i style="width:${pct}%" class="${pct >= 100 ? 'full' : ''}"></i></span><span class="quota-num">${v.limit == null ? `${v.used} · unlimited` : v.limit === 0 ? 'Not on this plan' : `${v.used} / ${v.limit}`}</span></div>`;
  }).join('');
  return rows ? `<div class="quota"><div class="eyebrow">THIS MONTH</div>${rows}<p class="hint">Allowances reset on the 1st (UTC).</p></div>` : '';
}
function usageHtml(u) {
  const money = (x) => `$${Number(x || 0).toFixed(3)}`;
  const stored = Array.isArray(u.stored) && u.stored.length ? u.stored : null;
  const rows = stored
    ? stored.map((r) => `<tr><td>${esc(r.tool)}</td><td>${esc(String(r.model).replace('claude-', ''))}</td><td>${r.calls}</td><td>${Number(r.input).toLocaleString()}</td><td>${Number(r.cache_read).toLocaleString()}</td><td>${Number(r.output).toLocaleString()}</td><td>${money(r.usd)}</td></tr>`)
    : Object.entries(u.byTool || {}).sort((a, b) => b[1].usd - a[1].usd).map(([t, r]) => `<tr><td>${esc(t)}</td><td>—</td><td>${r.calls}</td><td>${r.input.toLocaleString()}</td><td>${r.cacheRead.toLocaleString()}</td><td>${r.output.toLocaleString()}</td><td>${money(r.usd)}</td></tr>`);
  const total = stored ? stored.reduce((s, r) => s + Number(r.usd), 0) : u.total?.usd || 0;
  return `<p class="hint">${stored ? `Stored ledger for ${esc(u.month)} (all restarts).` : 'In-memory ledger since the last restart — run the 002_usage migration to keep history.'} Total <strong>${money(total)}</strong>.</p>
<table class="usage-table"><thead><tr><th>Feature</th><th>Model</th><th>Calls</th><th>Input</th><th>Cached</th><th>Output</th><th>Cost</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="7">No calls yet.</td></tr>'}</tbody></table>`;
}
$('#plan-chip').onclick = showBilling;
$('#profile-plan').onclick = showBilling;

/** Returning from Stripe Checkout: confirm the session server-side and store the entitlement token. */
async function handleCheckoutReturn() {
  const url = new URL(location.href);
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId) return;
  url.searchParams.delete('session_id'); history.replaceState(null, '', url.pathname + url.hash);
  try {
    const res = await confirmCheckout(sessionId);
    if (res.token) setToken(res.token);
    await loadBilling();
    render(); renderStatus();
    modal(`<div class="eyebrow">WELCOME TO ${esc(PLANS[res.plan].label.toUpperCase())}</div><h2>You’re set.</h2><p>${res.attached ? 'Everything is unlocked on your account, on any device you sign in to' : 'Everything is unlocked on this device'}${res.email ? `; Stripe has emailed a receipt to ${esc(res.email)}` : ''}. Manage or cancel any time from Plan &amp; billing.</p><div class="actions"><button class="primary" id="welcome-ok">Start with a role match</button></div>`);
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
  pages[session.page].bind({ loadSample, rebind, render, navigate });
}

function renderStatus() {
  const dot = $('.status-dot'), label = $('.top-status');
  dot.classList.toggle('on', aiAvailable());
  label.textContent = aiAvailable() ? `${providerLabel()} connected` : 'Browser-only prototype';
  label.title = aiAvailable() ? `AI analysis via ${session.ai.provider} (${session.ai.model}). Text is only sent when you ask.` : 'No AI provider configured on this server.';
  const b = session.billing || {};
  const current = plan();
  $('.profile small').textContent = b.subscribed ? `${PLANS[b.plan]?.label || 'Paid'} plan · manage` : `${PLANS[current].label} plan${billingEnabled() && current === 'free' ? ' · see plans' : ''}`;
  const si = $('#signin');
  si.hidden = !authEnabled();
  si.textContent = currentUser() ? (currentUser().email || 'Account') : 'Sign in';
  si.classList.toggle('signed', Boolean(currentUser()));
  const chip = $('#plan-chip');
  chip.textContent = previewing() ? `Previewing ${PLANS[plan()].label} · click to exit` : b.admin ? 'Admin · all features' : b.subscribed ? `${PLANS[b.plan]?.label || 'Paid'}${b.status === 'past_due' ? ' · payment failed' : b.renews ? ` · renews ${new Date(b.renews).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}` : `${PLANS[current].label}${billingEnabled() && current === 'free' ? ' · See plans' : ''}`;
  chip.classList.toggle('paid', Boolean(b.subscribed || b.admin));
  chip.classList.toggle('warn', b.status === 'past_due' || previewing());
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
<p class="hint">Your plan and subscription live under <button class="text-button" id="open-billing">Plan &amp; billing</button>.</p>
${session.billing?.admin && !session.billing?.subscribed ? `<details class="developer" ${previewing() ? 'open' : ''}><summary>Developer (admin)</summary><label class="field inline">Preview the app as another plan (this browser only; the server still treats you as admin)<select id="plan"><option value="" ${state.plan == null ? 'selected' : ''}>Server default (${PLANS[session.ai?.defaultPlan || 'free'].label})</option>${Object.entries(PLANS).map(([k, p]) => `<option value="${k}" ${state.plan === k ? 'selected' : ''}>${p.label} · ${p.price}</option>`).join('')}</select></label></details>` : ''}
<div class="actions"><button class="secondary" id="export-workspace">Export workspace</button><button class="secondary" id="clear-workspace">Clear all workspace data</button></div>`);
  $('#remember').onchange = (e) => { state.remember = e.target.checked; if (!state.remember) forget(); save(); toast(state.remember ? 'Device saving enabled.' : 'Device saving disabled.'); };
  $('#consent') && ($('#consent').onchange = (e) => { state.aiConsent = e.target.checked; save(); });
  $('#plan') && ($('#plan').onchange = (e) => { state.plan = e.target.value || null; save(); render(); renderStatus(); toast(previewing() ? `Previewing the ${PLANS[plan()].label} plan. Click the plan chip to exit.` : 'Preview off.'); });
  $('#open-billing').onclick = () => { closeModal(); showBilling(); };
  $('#export-workspace').onclick = () => download('roledone-workspace.json', JSON.stringify(state, null, 2), 'application/json');
  $('#clear-workspace').onclick = async () => {
    closeModal();
    if (await confirm({ title: 'Clear all workspace data?', body: 'This removes the CV, draft, practice answers, suggestions, and application records from this tab and this browser’s saved workspace. Export a copy first if needed.', action: 'Clear everything' })) {
      reset(); navigate('overview'); toast('Workspace cleared.');
    }
  };
};
$('#mobile-settings').onclick = () => $('#settings').click();

document.addEventListener('roledone:billing', () => { renderStatus(); const h = $('.quota-hint'); if (h) h.outerHTML = match.quotaHint(); rebind(); });
document.addEventListener('roledone:upgrade', async (e) => {
  const before = plan();
  await loadBilling().catch(() => {}); renderStatus();
  const now = plan();
  if (e.detail?.error && !e.detail.quota && before !== 'free') {
    // The server refused a paid feature while this browser believed it was on a paid plan.
    const b = session.billing || {};
    if (now === 'free') toast(`Your sign-in or subscription could not be confirmed (server sees: ${PLANS[now].label}${b.user || currentUser() ? '' : ', not signed in'}). Sign in again and retry.`);
    else toast(`The server refused this once (${e.detail.error.message}) but your plan is ${PLANS[now].label}. Please retry; if it repeats, reload the page.`);
    if (now === 'free') showPlans({});
    return;
  }
  showPlans(e.detail?.quota ? { quota: e.detail.quota } : {});
});

window.addEventListener('hashchange', () => {
  const next = location.hash.slice(1);
  if (next !== session.page) { session.page = names[next] ? next : 'overview'; render(); }
});

session.page = names[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
render();
loadStatus().then(async (status) => {
  let signedInNow = false;
  try { signedInNow = await captureSessionFromUrl(); } catch (error) { toast(error.message); }
  if (signedInNow) { session.page = 'overview'; load(); }
  await loadBilling(); renderStatus(); if (status.ai || session.billing?.subscribed || signedInNow) render();
  if (signedInNow) await afterSignIn();
  await handleCheckoutReturn();
});
loadSourceDoc().then(() => { if (session.sourceDoc && session.page === 'editor') render(); });
