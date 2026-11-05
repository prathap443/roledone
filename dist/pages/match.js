import { state, session, setSources, requirements, save } from '../state.js';
import { $, esc, heading, toast, busy, pill } from '../ui.js';
import { extractCV } from '../import-cv.js';
import * as api from '../api.js';

export function render() {
  const ai = api.aiAvailable();
  return heading('01 / FIND THE CONNECTION', 'Meet your next opportunity.', 'Bring your experience and a role together. See where the evidence is.') + `
<div class="notice">${ai
    ? `${api.providerLabel()} reads the job description, lists its requirements, and quotes the lines in your CV that support each one. A quote is evidence of a mention, not verified proficiency, an ATS score, or a hiring prediction.`
    : 'AI analysis is not connected on this server, so matching checks a small, fixed skill vocabulary. A mention is not verified proficiency, an ATS score, or a prediction of hiring outcomes.'}</div>
<form id="match-form"><div class="two-col">
 <section class="panel"><h2>Your experience</h2>
  <label class="field">CV text<textarea id="cv" required maxlength="50000" placeholder="Paste your CV here…">${esc(state.cv)}</textarea></label>
  <label class="file-label">Upload your CV <input type="file" id="cv-file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" aria-describedby="upload-help upload-status"></label>
  <p class="hint" id="upload-help">PDF, Word (.docx), or TXT · up to 10 MB. Read privately in your browser. Review the extracted text before matching.</p>
  <p class="hint" id="upload-status" role="status" aria-live="polite"></p>
 </section>
 <section class="panel"><h2>The opportunity</h2>
  <label class="field">Job description<textarea id="jd" required maxlength="50000" placeholder="Paste the job description here…">${esc(state.jd)}</textarea></label>
  <p class="hint">Include the technical requirements and responsibilities. Review the original advert for anything the analysis may miss.</p>
  <div class="actions">
   ${ai ? '<button class="primary" type="submit" id="match-ai">Find the connections ✧</button><button class="secondary" type="button" id="match-local">Quick text check (no AI)</button>' : '<button class="primary" type="submit" id="match-local">Find the connections ↗</button>'}
   <button class="secondary" type="button" id="sample">Use sample data</button>
  </div>
 </section>
</div></form>
<div id="results" class="results">${state.cv && state.jd ? results() : ''}</div>`;
}

export function results() {
  const rows = requirements();
  const found = rows.filter((r) => r.status !== 'gap').length;
  const mode = state.requirements ? `${api.providerLabel().toUpperCase()} ANALYSIS` : session.isSample ? 'SAMPLE DATA · TEXT CHECK' : 'TEXT CHECK';
  const meta = state.matchMeta;
  return `<section class="panel">
<div class="section-heading"><h2>${found} of ${rows.length} requirements have evidence in your CV</h2><span>${mode}</span></div>
<p class="hint">${rows.length ? 'Check the context of every quote. A missing mention may mean missing evidence, not missing ability.' : state.requirements ? 'No requirements were found in that text. Paste the full job description, including the skills and responsibilities sections.' : 'No supported skill terms found. Try the AI analysis if available, or a more detailed technical job description.'}${meta?.dropped ? ` ${meta.dropped} suggestion${meta.dropped > 1 ? 's were' : ' was'} discarded because the AI could not quote a source for them.` : ''}</p>
${rows.map((r) => `<div class="evidence-row">
 <div class="evidence-top"><h3>${esc(r.name)}${r.kind === 'nice' ? ' <span class="tag muted">NICE TO HAVE</span>' : r.kind === 'responsibility' ? ' <span class="tag muted">RESPONSIBILITY</span>' : ''}</h3>${pill(r.status)}</div>
 ${r.source ? `<p class="source-quote"><span>The role asks for</span> “${esc(r.source)}”</p>` : ''}
 <p>${r.evidence ? `<span class="quote-label">Your CV says</span> “${esc(r.evidence)}”` : 'Not found in your CV text. Add an example only if you have this experience, or make it a learning goal.'}</p>
 ${r.note ? `<p class="hint">${esc(r.note)}</p>` : ''}
</div>`).join('')}
<div class="actions"><button class="primary" data-page="editor">Continue to CV studio ↗</button><button class="secondary" data-page="interview">Practise for this role</button></div>
</section>`;
}

export function bind({ loadSample, rebind }) {
  $('#sample')?.addEventListener('click', loadSample);

  const readForm = () => {
    const cv = $('#cv').value.trim(), jd = $('#jd').value.trim();
    if (!cv || !jd) { toast('Add both your CV and the job description.'); return null; }
    return { cv, jd };
  };
  const showResults = () => { $('#results').innerHTML = results(); rebind('#results'); $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  const runLocal = () => {
    const input = readForm(); if (!input) return;
    setSources(input);
    state.requirements = null; state.matchMeta = null; save();
    showResults();
  };

  const runAI = async (button) => {
    const input = readForm(); if (!input) return;
    if (!(await api.ensureConsent())) return;
    await busy(button, 'Reading the role…', async () => {
      const result = await api.match(input.cv, input.jd);
      setSources(input);
      session.isSample = false;
      state.requirements = result.requirements; state.matchMeta = result.meta; save();
      showResults();
      toast(`${result.requirements.length} requirements found.`);
    });
  };

  $('#match-form')?.addEventListener('submit', (e) => { e.preventDefault(); if ($('#match-ai')) runAI($('#match-ai')); else runLocal(); });
  $('#match-ai') && ($('#match-local').onclick = runLocal);

  $('#cv-file')?.addEventListener('change', async (e) => {
    const input = e.target, file = input.files[0];
    if (!file) return;
    const area = $('#cv'), status = $('#upload-status'), buttons = [...document.querySelectorAll('#match-form .actions button')];
    input.disabled = true; area.readOnly = true; buttons.forEach((b) => (b.disabled = true));
    status.textContent = `Reading ${file.name}…`; status.setAttribute('aria-busy', 'true');
    try {
      const text = await extractCV(file);
      if (!input.isConnected) return;
      area.value = text;
      setSources({ cv: text, jd: $('#jd').value });
      session.isSample = false;
      $('#results').innerHTML = '';
      status.textContent = `${file.name} loaded. Review the text above, then find the connections.`;
    } catch (error) {
      if (input.isConnected) { status.textContent = error.message; toast(error.message); }
    } finally {
      input.disabled = false; area.readOnly = false; buttons.forEach((b) => (b.disabled = false));
      status.removeAttribute('aria-busy'); input.value = '';
    }
  });
}
