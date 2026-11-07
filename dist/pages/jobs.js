// Jobs: search live adverts and hand one straight to Role match. The server proxies the job source;
// nothing about the user is sent to it beyond the search words.
import { state, session, setSources, save } from '../state.js';
import { $, $$, esc, heading, toast, confirm } from '../ui.js';
import * as api from '../api.js';

const initials = (name) => String(name || '?').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const ago = (iso) => { if (!iso) return ''; const d = Math.round((Date.now() - new Date(iso)) / 86400000); return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 30 ? `${d} days ago` : ''; };

/** One job card. Used here and in the overview carousel. */
export function jobCard(j, { compact = false } = {}) {
  return `<article class="job-card ${compact ? 'compact' : ''}" data-job="${esc(j.id)}">
 <header><span class="job-logo" style="--h:${hue(j.company)}">${esc(initials(j.company))}</span><div><h3 title="${esc(j.title)}">${esc(j.title)}</h3><p>${esc(j.company)}</p></div></header>
 <ul class="job-facts"><li><span>◎</span>${esc(j.location)}${j.remote && !/remote/i.test(j.location) ? ' · Remote' : ''}</li><li><span>¤</span>${j.salary ? esc(j.salary) : 'Salary not stated'}</li></ul>
 <p class="job-summary">${esc(j.summary)}${j.summary.length >= 320 ? '…' : ''}</p>
 <div class="job-tags">${j.type ? `<span class="tag">${esc(j.type)}</span>` : ''}${j.category ? `<span class="tag">${esc(j.category)}</span>` : ''}${ago(j.posted) ? `<span class="tag muted">${ago(j.posted)}</span>` : ''}</div>
 <div class="job-actions"><button class="primary small" data-scan="${esc(j.id)}">Scan my CV for this role ✧</button>${j.url ? `<a class="secondary small" href="${esc(j.url)}" target="_blank" rel="noopener">View advert ↗</a>` : ''}</div>
</article>`;
}

export function render() {
  const q = session.jobs?.query || {};
  const countries = session.jobs?.countries || { gb: 'United Kingdom' };
  return heading('FIND THE ROLE', 'Live roles, matched against your evidence.', 'Search real adverts, then scan any of them against your CV in one click.') + `
<form id="jobs-form" class="panel jobs-search" role="search">
 <label class="field grow">What<input id="jobs-q" type="search" placeholder="data engineer, machine learning, agents…" value="${esc(q.q || '')}" maxlength="120"></label>
 <label class="field">Where<input id="jobs-where" type="text" placeholder="London, remote…" value="${esc(q.where || '')}" maxlength="80" ${Object.keys(countries).length === 1 && countries.remote ? 'disabled' : ''}></label>
 <label class="field">Country<select id="jobs-country">${Object.entries(countries).map(([k, v]) => `<option value="${k}" ${k === (q.country || 'gb') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
 <button class="primary" type="submit">Search roles ↗</button>
</form>
<div id="jobs-results" class="jobs-results">${session.jobs?.result ? resultsHtml(session.jobs.result) : '<p class="hint">Try “data engineer”, “platform”, or the name of a tool you know well. Results come from public job boards; Roledone never sends your CV to them.</p>'}</div>`;
}

function resultsHtml(r) {
  if (!r.jobs.length) return '<div class="empty-state"><h3>No roles found</h3><p>Try fewer words, a broader location, or another country.</p></div>';
  return `<div class="section-heading"><h2>${r.total ? `${r.total.toLocaleString('en-GB')} roles` : `${r.jobs.length} roles`}</h2><span>VIA ${esc(String(r.source).toUpperCase())}${r.jobs[0]?.partial ? ' · SUMMARIES; FULL ADVERT ON THE SOURCE' : ''}</span></div>
<div class="job-grid">${r.jobs.map((j) => jobCard(j)).join('')}</div>
${r.hasMore ? '<div class="actions"><button class="secondary" id="jobs-more">More roles</button></div>' : ''}`;
}

/** Put a job's text into Role match. Shared with the overview carousel. */
export async function scanJob(j, navigate) {
  if (state.jd && state.jd !== jobText(j)) {
    const ok = await confirm({ title: 'Replace the current job description?', body: `Role match will switch to “${j.title}” at ${j.company}. Your CV and draft stay as they are; the previous match results are cleared.`, action: 'Use this role' });
    if (!ok) return;
  }
  setSources({ jd: jobText(j) });
  session.isSample = false;
  session.job = { id: j.id, title: j.title, company: j.company, url: j.url, partial: j.partial };
  navigate('match');
  toast(j.partial ? 'Only the summary was available. Paste the full advert from the source for the best match.' : `${j.title} loaded into Role match.`);
}

export const jobText = (j) => `${j.title} — ${j.company}\n${j.location}${j.salary ? ` · ${j.salary}` : ''}${j.type ? ` · ${j.type}` : ''}\n\n${j.description}`;

export async function search(query, { append = false } = {}) {
  const params = new URLSearchParams({ q: query.q || '', where: query.where || '', country: query.country || 'gb', page: String(query.page || 1) });
  const r = await api.jobs(params);
  session.jobs = session.jobs || {};
  session.jobs.countries = r.countries || session.jobs.countries;
  session.jobs.query = query;
  session.jobs.result = append && session.jobs.result ? { ...r, jobs: [...session.jobs.result.jobs, ...r.jobs] } : r;
  return session.jobs.result;
}

export function bind({ render: rerender, navigate }) {
  $('#jobs-form').onsubmit = async (e) => {
    e.preventDefault();
    const button = e.submitter || $('#jobs-form button[type=submit]');
    const query = { q: $('#jobs-q').value.trim(), where: $('#jobs-where').value.trim(), country: $('#jobs-country').value, page: 1 };
    button.disabled = true; button.textContent = 'Searching…';
    try { await search(query); rerender(); } catch (error) { toast(error.message); button.disabled = false; button.textContent = 'Search roles ↗'; }
  };
  $('#jobs-more')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Loading…';
    try { await search({ ...session.jobs.query, page: (session.jobs.query.page || 1) + 1 }, { append: true }); rerender(); window.scrollTo(0, document.body.scrollHeight - 1200); } catch (error) { toast(error.message); b.disabled = false; b.textContent = 'More roles'; }
  });
  bindScan(session.jobs?.result?.jobs || [], navigate);
  if (!session.jobs?.countries) api.jobs(new URLSearchParams({ q: '', page: '1' })).then((r) => { session.jobs = { ...(session.jobs || {}), countries: r.countries }; if (session.page === 'jobs' && !session.jobs.result) rerender(); }).catch(() => {});
}

export function bindScan(jobs, navigate) {
  $$('[data-scan]').forEach((b) => (b.onclick = () => { const j = jobs.find((x) => x.id === b.dataset.scan); if (j) scanJob(j, navigate); }));
}
