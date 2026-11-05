// Rolewoven app shell: routing, navigation, workspace settings, and the AI status indicator.
// Pages live in ./pages/*.js; shared state in ./state.js; server calls in ./api.js.

import { sampleCV, sampleJD } from './core.js';
import { state, session, load, save, reset, forget, setSources, setStorageErrorHandler } from './state.js';
import { $, $$, esc, toast, modal, closeModal, confirm, download } from './ui.js';
import { loadStatus, aiAvailable, providerLabel } from './api.js';
import * as overview from './pages/overview.js';
import * as match from './pages/match.js';
import * as editor from './pages/editor.js';
import * as interview from './pages/interview.js';
import * as applications from './pages/applications.js';

const pages = { overview, match, editor, interview, applications };
const names = { overview: 'Overview', match: 'Role match', editor: 'CV studio', interview: 'Interview room', applications: 'Applications' };

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
}

function render() {
  $('#breadcrumb').innerHTML = `Workspace <b>/ ${names[session.page]}</b>`;
  $$('nav button').forEach((b) => {
    const active = b.dataset.page === session.page;
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
  $('.profile small').textContent = aiAvailable() ? 'AI-assisted workspace' : 'Local prototype';
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

$('#help').onclick = () => modal(`<div class="eyebrow">ROLEWOVEN / EARLY ACCESS</div><h2>Real experience. A clearer story.</h2>
<p>Match a role, edit your CV, practise interview answers, and track applications.</p>
<p>${aiAvailable()
    ? `AI analysis is provided by ${esc(providerLabel())}. It reads your text only when you press an AI button, must quote your own CV for every claim, and is blocked from inventing numbers, tools, or achievements. Rolewoven does not store your documents.`
    : 'No AI provider is configured on this server, so matching and feedback use simple local rules.'}</p>
<p>Import PDF, DOCX, or TXT files up to 10 MB; export edited CVs as TXT. Scanned PDFs need OCR first. Your content stays in this tab unless you enable device saving.</p>`);

$('#settings').onclick = () => {
  modal(`<h2>Your workspace, your choice.</h2>
<p>Device saving stores CV text, drafts, answers, and applications in this browser’s local storage. This is not an encrypted document vault. Use a trusted device.</p>
<label class="field"><span><input type="checkbox" id="remember" ${state.remember ? 'checked' : ''}> Save my workspace on this device</span></label>
${aiAvailable() ? `<label class="field"><span><input type="checkbox" id="consent" ${state.aiConsent ? 'checked' : ''}> Send text to ${esc(providerLabel())} without asking each time</span></label>` : ''}
<div class="actions"><button class="secondary" id="export-workspace">Export workspace</button><button class="secondary" id="clear-workspace">Clear all workspace data</button></div>`);
  $('#remember').onchange = (e) => { state.remember = e.target.checked; if (!state.remember) forget(); save(); toast(state.remember ? 'Device saving enabled.' : 'Device saving disabled.'); };
  $('#consent') && ($('#consent').onchange = (e) => { state.aiConsent = e.target.checked; save(); });
  $('#export-workspace').onclick = () => download('rolewoven-workspace.json', JSON.stringify(state, null, 2), 'application/json');
  $('#clear-workspace').onclick = async () => {
    closeModal();
    if (await confirm({ title: 'Clear all workspace data?', body: 'This removes the CV, draft, practice answers, suggestions, and application records from this tab and this browser’s saved workspace. Export a copy first if needed.', action: 'Clear everything' })) {
      reset(); navigate('overview'); toast('Workspace cleared.');
    }
  };
};
$('#mobile-settings').onclick = () => $('#settings').click();

window.addEventListener('hashchange', () => {
  const next = location.hash.slice(1);
  if (next !== session.page) { session.page = names[next] ? next : 'overview'; render(); }
});

session.page = names[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
render();
loadStatus().then((status) => { renderStatus(); if (status.ai) render(); }); // re-render only when AI buttons need to appear
