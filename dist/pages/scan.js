import { state, session, setSources, save } from '../state.js';
import { scanCV } from '../scan.js';
import { $, $$, esc, heading, toast, busy } from '../ui.js';
import { extractCVWithSource } from '../import-cv.js';
import { can, needs } from '../plans.js';
import * as api from '../api.js';

const BANDS = { exceptional: ['Exceptional', 'This CV already does most of the work.'], strong: ['Strong', 'Clear technical depth; a few lines are underselling you.'], developing: ['Developing', 'The experience is there; the CV is not yet showing it.'], 'needs-work': ['Needs work', 'Structure and evidence need attention before this is sent.'] };
const grade = (n) => (n >= 85 ? ['Excellent', 'good'] : n >= 70 ? ['Strong', 'good'] : n >= 50 ? ['Needs work', 'warn'] : ['Weak', 'bad']);

export function render() {
  const intro = heading('00 / START HERE', 'How does your CV read?', 'Upload or paste it. Four checks run in your browser; the AI agent adds its first observations.');
  if (!state.cv) return intro + uploadForm();
  const scan = state.scan || scanCV(state.cv);
  return intro + report(scan) + `<p class="hint centre"><button class="text-button" id="rescan-new">Scan a different CV ↗</button></p>`;
}

function uploadForm() {
  return `<div class="notice">Parse-ability, impact, readability and role coverage are rule-based and explained line by line. There is no ATS emulation and no hiring prediction; the score tells you how clearly the CV shows what you have done.</div>
<section class="panel scan-intake"><form id="scan-form">
 <label class="field">Paste your CV<textarea id="scan-cv" maxlength="50000" placeholder="Paste the full text of your CV…"></textarea></label>
 <div class="actions">
  <label class="file-label">Upload instead <input type="file" id="scan-file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" aria-describedby="scan-status"></label>
  <button class="primary" type="submit">Scan my CV ↗</button>
 </div>
 <p class="hint" id="scan-status" role="status" aria-live="polite">PDF, Word (.docx) or TXT · up to 10 MB · read privately in your browser.</p>
</form></section>`;
}

function report(scan) {
  const p = scan.parts;
  const [bandLabel, bandCopy] = BANDS[scan.band];
  const s = state.scanSummary;
  const tile = (key, label, value, note) => { const [g, cls] = grade(value); return `<button class="tile ${cls}" data-tile="${key}" aria-expanded="${session.tile === key}"><span class="tile-label">${label}</span><strong>${value}</strong><span class="bar"><i style="width:${value}%"></i></span><span class="grade">${g}</span><small>${note}</small></button>`; };
  return `
<section class="panel scan-hero">
 <div class="score-ring-wrap big"><div class="score-ring big ${scan.band}" style="--target:${scan.score}"></div><div class="score-label"><strong>${scan.score}</strong><span>/ 100</span></div></div>
 <div class="scan-copy">
  <div class="eyebrow">YOUR CV SCORE · <span class="band-chip ${scan.band}">${bandLabel}</span></div>
  <h2>${s?.headline ? esc(s.headline) : bandCopy}</h2>
  <p>${s?.target_role ? `Reads as a <strong>${esc(s.target_role)}</strong> CV. ` : ''}${scan.words} words · scored against ${p.coverage.total} common ${esc(p.coverage.role)} requirements.</p>
  <div class="actions">
   ${api.aiAvailable() && !s ? `<button class="primary lime" id="summarise">AI agent · first observations ✧</button>` : ''}
   <button class="secondary" data-page="match">Compare to a job description →</button>
   <button class="secondary" id="print">Download PDF ↓</button>
  </div>
 </div>
 <div class="bands"><span>SCORE BANDS</span><i class="needs-work"></i>0–49 Needs work <i class="developing"></i>50–69 Developing <i class="strong"></i>70–84 Strong <i class="exceptional"></i>85–100 Exceptional</div>
</section>

<div class="section-heading"><h2>Score breakdown</h2><span>CLICK A TILE FOR THE RULES BEHIND IT</span></div>
<div class="tiles">
 ${tile('parse', 'ATS parse-ability', p.parse.score, `${p.parse.checks.filter((c) => c.ok).length} of ${p.parse.checks.length} structure checks`)}
 ${tile('coverage', 'Role coverage', p.coverage.score, `${p.coverage.found.length} of ${p.coverage.total} requirements mentioned`)}
 ${tile('impact', 'Impact statements', p.impact.score, `${p.impact.quantified} of ${p.impact.total} bullets carry a number`)}
 ${tile('readability', 'Readability', p.readability.score, `${p.readability.buzzwords.length} buzzwords · ${p.readability.passive} passive lines`)}
</div>
<div id="tile-detail">${session.tile ? detail(scan, session.tile) : ''}</div>

<div class="two-col scan-lists">
 <section class="panel good-list"><h2>✓ What already works</h2>${s ? (s.strengths.length ? `<ul>${s.strengths.map((x) => `<li>${esc(x.text)}<q>${esc(x.evidence)}</q></li>`).join('')}</ul>` : '<p class="hint">The AI agent found nothing it could back with a quote.</p>') : localStrengths(scan)}</section>
 <section class="panel fix-list"><h2>! Critical fixes</h2>${s ? `<ol>${s.fixes.map((x) => `<li><strong>${esc(x.text)}</strong><p>${esc(x.why)}</p>${x.evidence ? `<q>${esc(x.evidence)}</q>` : ''}</li>`).join('')}</ol>` : localFixes(scan)}</section>
</div>

<section class="panel next-bar">
 <div><div class="eyebrow">NEXT STEPS</div><h3>Turn the score into a stronger CV.</h3></div>
 <div class="actions">
  <button class="primary" data-page="match">Compare to a job description →</button>
  ${can('suggestions') ? '<button class="secondary" data-page="editor">Fix these in CV studio ✧</button><button class="secondary" data-page="templates">Put it in a template</button>' : `<button class="secondary" data-upgrade>Fix these with the AI agent · ${esc(needs('suggestions'))}</button>`}
 </div>
</section>`;
}

function localStrengths(scan) {
  const p = scan.parts, items = [];
  if (p.coverage.found.length >= p.coverage.total * 0.6) items.push(`Mentions ${p.coverage.found.length} of ${p.coverage.total} common ${p.coverage.role} requirements.`);
  if (p.impact.strong >= p.impact.total * 0.6 && p.impact.total) items.push(`${p.impact.strong} of ${p.impact.total} achievement lines open with a strong verb.`);
  if (p.impact.quantified >= p.impact.total * 0.5 && p.impact.total) items.push(`${p.impact.quantified} achievement lines carry a measurable outcome.`);
  if (p.parse.score >= 80) items.push('Standard structure: parsers and recruiters will find the sections they expect.');
  if (!p.readability.buzzwords.length) items.push('No empty buzzwords.');
  return items.length ? `<ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="hint">Ask the AI agent for first observations backed by quotes from your CV.</p>';
}

function localFixes(scan) {
  const p = scan.parts, items = [];
  if (p.impact.total && p.impact.quantified < p.impact.total * 0.5) items.push([`${p.impact.total - p.impact.quantified} achievement lines have no measurable outcome.`, 'If a line had a real result — time saved, failures cut, users served — add it. Leave it out if you cannot stand behind the number.']);
  if (p.impact.weak) items.push([`${p.impact.weak} lines start with “responsible for”, “worked on” or similar.`, 'Lead with what you did: designed, migrated, reduced, led.']);
  if (p.coverage.missing.length) items.push([`Not mentioned: ${p.coverage.missing.slice(0, 5).join(', ')}${p.coverage.missing.length > 5 ? '…' : ''}.`, 'If you have done these, the CV is hiding them. Compare to a job description to see which matter for a specific role.']);
  for (const c of p.parse.checks.filter((c) => !c.ok).slice(0, 2)) items.push([c.label, c.detail]);
  if (p.readability.buzzwords.length) items.push([`Buzzwords: ${p.readability.buzzwords.join(', ')}.`, 'Replace each with a specific thing you did.']);
  return items.length ? `<ol>${items.slice(0, 3).map(([t, w]) => `<li><strong>${esc(t)}</strong><p>${esc(w)}</p></li>`).join('')}</ol>` : '<p class="hint">Nothing critical from the rule-based checks.</p>';
}

function detail(scan, key) {
  const p = scan.parts;
  const quote = (l) => `<q>${esc(l)}</q>`;
  if (key === 'parse') return `<section class="panel detail"><h3>ATS parse-ability — structure an applicant tracking system or recruiter can read</h3><p class="hint">These are structural checks (sections, dates, bullets, columns), not a simulation of any specific ATS product.</p><ul class="checks">${p.parse.checks.map((c) => `<li class="${c.ok ? 'ok' : 'no'}"><span>${c.ok ? '✓' : '○'}</span><div><strong>${esc(c.label)}</strong><p>${esc(c.detail)}</p></div></li>`).join('')}</ul></section>`;
  if (key === 'impact') return `<section class="panel detail"><h3>Impact — do your bullets show outcomes?</h3><p>${p.impact.total} achievement lines analysed. ${p.impact.quantified} carry a number, ${p.impact.strong} open with a strong verb, ${p.impact.weak} open weakly. Score = 60% quantified + 40% strong verbs, minus weak openers.</p>${p.impact.examples.weak.length ? `<h4>Weak openers</h4>${p.impact.examples.weak.map(quote).join('')}` : ''}${p.impact.examples.unquantified.length ? `<h4>No measurable outcome yet</h4>${p.impact.examples.unquantified.map(quote).join('')}<p class="hint">Add a number only if it is true and you can explain it in an interview.</p>` : ''}</section>`;
  if (key === 'readability') return `<section class="panel detail"><h3>Readability — can it be scanned in six seconds?</h3><p>Average sentence ${p.readability.averageSentence} words · ${p.readability.longSentences} over 30 words · ${p.readability.passive} passive constructions · ${p.readability.buzzwords.length} buzzwords${p.readability.buzzwords.length ? ` (${esc(p.readability.buzzwords.join(', '))})` : ''}.</p>${p.readability.examples.long.map(quote).join('')}${p.readability.examples.passive.map(quote).join('')}</section>`;
  if (key === 'coverage') return `<section class="panel detail"><h3>Role coverage — ${esc(p.coverage.role)} requirements mentioned</h3><p class="hint">A curated list of what ${esc(p.coverage.role)} adverts commonly ask for. A mention is not proficiency; a gap is not inability. Compare to a real job description for the ones that matter.</p><div class="chips">${p.coverage.found.map((f) => `<span class="chip ok" title="${esc(f.evidence || '')}">${esc(f.name)}</span>`).join('')}${p.coverage.missing.map((m) => `<span class="chip no">${esc(m)}</span>`).join('')}</div></section>`;
  return '';
}

export function bind({ rebind, render: rerender }) {
  const runScan = (cv, sourceDoc = null) => {
    setSources({ cv, sourceDoc });
    state.scan = scanCV(cv); state.scanSummary = null; session.tile = null; save();
    rerender(); window.scrollTo(0, 0);
    toast(`CV score ${state.scan.score}.`);
  };
  $('#scan-form')?.addEventListener('submit', (e) => { e.preventDefault(); const cv = $('#scan-cv').value.trim(); if (cv.split(/\s+/).length < 20) { toast('Paste the full CV text first.'); return; } runScan(cv); });
  $('#scan-file')?.addEventListener('change', async (e) => {
    const input = e.target, file = input.files[0]; if (!file) return;
    const status = $('#scan-status'); status.textContent = `Reading ${file.name}…`; input.disabled = true;
    try { const { text, source } = await extractCVWithSource(file); runScan(text, source); } catch (error) { status.textContent = error.message; toast(error.message); } finally { input.disabled = false; input.value = ''; }
  });
  $$('[data-tile]').forEach((b) => (b.onclick = () => { session.tile = session.tile === b.dataset.tile ? null : b.dataset.tile; $$('[data-tile]').forEach((t) => t.setAttribute('aria-expanded', t.dataset.tile === session.tile)); $('#tile-detail').innerHTML = session.tile ? detail(state.scan || scanCV(state.cv), session.tile) : ''; }));
  $('#print')?.addEventListener('click', () => window.print());
  $('#rescan-new')?.addEventListener('click', () => { session.scanNew = true; setSources({ cv: '' }); state.scan = null; state.scanSummary = null; save(); rerender(); });
  $('#summarise')?.addEventListener('click', async (e) => {
    const button = e.currentTarget;
    if (!(await api.ensureConsent())) return;
    await busy(button, 'Reading your CV…', async () => {
      const res = await api.scanSummary({ cv: state.cv, scan: state.scan || scanCV(state.cv) });
      state.scanSummary = res.summary; save(); rerender();
    });
  });
}
