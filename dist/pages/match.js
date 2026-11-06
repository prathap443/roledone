import { state, session, setSources, setDraft, currentDraft, requirements, save } from '../state.js';
import { evidenceScore } from '../core.js';
import { $, $$, esc, heading, toast, busy, pill, locked } from '../ui.js';
import { extractCV } from '../import-cv.js';
import { can, needs } from '../plans.js';
import * as api from '../api.js';

export function render() {
  const ai = api.aiAvailable();
  const blank = !state.cv && !state.jd;
  return heading('01 / FIND THE CONNECTION', 'Meet your next opportunity.', 'Bring your experience and a role together. See where the evidence is.') + `
<div class="notice">${ai
    ? `${api.providerLabel()} reads the job description, lists its requirements, and quotes the lines in your CV that support each one. Your Evidence Score is how much of the role your CV already covers — a coverage measure, not an ATS score or a hiring prediction.`
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
   ${ai ? '<button class="primary" type="submit" id="match-ai">Scan my CV for this role ✧</button><button class="secondary" type="button" id="match-local">Quick text check (no AI)</button>' : '<button class="primary" type="submit" id="match-local">Find the connections ↗</button>'}
   ${blank ? '<button class="secondary" type="button" id="sample">Try a sample instead</button>' : ''}
  </div>
  ${blank ? '' : '<p class="hint">No CV to hand? Clear both boxes to try the fictional sample.</p>'}
 </section>
</div></form>
<div id="results" class="results">${state.cv && state.jd ? results() : ''}</div>`;
}

const ORDER = { gap: 0, partial: 1, evidence: 2 };

export function results() {
  const rows = [...requirements()].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const score = evidenceScore(rows);
  const mode = state.requirements ? `${api.providerLabel().toUpperCase()} ANALYSIS` : session.isSample ? 'SAMPLE DATA · TEXT CHECK' : 'TEXT CHECK';
  const meta = state.matchMeta;
  const gaps = rows.filter((r) => r.status !== 'evidence');
  return `${score ? scoreCard(score, mode) : ''}
<section class="panel">
<div class="section-heading"><h2>${gaps.length ? `${gaps.length} requirement${gaps.length > 1 ? 's' : ''} to work on` : 'Every requirement has evidence'}</h2><span>${rows.length} FOUND IN THE ADVERT</span></div>
<p class="hint">${rows.length ? 'Gaps first. A missing mention may mean missing evidence, not missing ability — that is what the Gap Interview is for.' : state.requirements ? 'No requirements were found in that text. Paste the full job description, including the skills and responsibilities sections.' : 'No supported skill terms found. Try the AI analysis if available, or a more detailed technical job description.'}${meta?.dropped ? ` ${meta.dropped} item${meta.dropped > 1 ? 's were' : ' was'} discarded because the AI could not quote a source for them.` : ''}</p>
${rows.map(requirementRow).join('')}
<div class="actions"><button class="primary" data-page="editor">Continue to CV studio ↗</button><button class="secondary" data-page="interview">Practise for this role</button></div>
</section>`;
}

function scoreCard(s, mode) {
  const words = { strong: 'Strong match on paper.', good: 'Good foundation, a few things to show.', developing: 'Relevant, but the CV is leaving evidence out.', early: 'The CV does not yet show this role.' };
  return `<section class="panel score-card">
 <div class="score-ring ${s.band}"><strong>${s.score}</strong><span>EVIDENCE<br>SCORE</span></div>
 <div class="score-copy">
  <div class="eyebrow">${mode}</div>
  <h2>${words[s.band]}</h2>
  <p>${s.evidence} of ${s.total} requirements have a supporting line in your CV${s.partial ? `, ${s.partial} partial` : ''}${s.gap ? `, ${s.gap} missing` : ''}. ${s.must ? `Must-haves: ${s.mustEvidence} of ${s.must} evidenced.` : ''}</p>
  <p class="hint">Must-haves count fully, nice-to-haves half. The score rises as you add evidence — through the Gap Interview or by applying suggestions in CV studio.</p>
 </div>
</section>`;
}

function requirementRow(r) {
  const gap = state.gaps[r.id];
  return `<div class="evidence-row ${r.status}" data-req="${r.id}">
 <div class="evidence-top"><h3>${esc(r.name)}${r.kind === 'nice' ? ' <span class="tag muted">NICE TO HAVE</span>' : r.kind === 'responsibility' ? ' <span class="tag muted">RESPONSIBILITY</span>' : ''}</h3>${pill(r.status)}</div>
 ${r.source ? `<p class="source-quote"><span>The role asks for</span> “${esc(r.source)}”</p>` : ''}
 <p>${r.evidence ? `<span class="quote-label">Your CV says</span> “${esc(r.evidence)}”` : 'Not mentioned anywhere in your CV text.'}</p>
 ${r.note ? `<p class="hint">${esc(r.note)}</p>` : ''}
 ${(r.status !== 'evidence' || gap?.result?.added) && api.aiAvailable() && state.requirements ? gapInterview(r, gap) : ''}
</div>`;
}

function gapInterview(r, gap) {
  if (!can('gapInterview')) {
    return `<div class="gap-cta locked-inline"><span>Have this experience but never wrote it down? The Gap Interview asks you two questions and drafts the bullet from your answer.</span><button class="secondary" data-upgrade>${esc(needs('gapInterview'))} feature · See plans</button></div>`;
  }
  if (!gap) return `<div class="gap-cta"><span>Have this experience but never wrote it down?</span><button class="secondary" data-gap-start="${r.id}">Answer two quick questions ✧</button></div>`;
  if (gap.result) {
    const res = gap.result;
    if (res.added) return `<div class="gap-done">✓ Added to your CV draft: <em>${esc(res.bullet)}</em></div>`;
    if (res.verdict === 'unsupported') return `<div class="gap-result unsupported"><strong>Not enough to claim it — and that is fine.</strong><p>${esc(res.explanation)}</p>${res.learning_line ? `<p class="hint">Truthful alternative: “${esc(res.learning_line)}”</p><div class="actions"><button class="secondary" data-gap-learning="${r.id}">Add as a learning goal</button><button class="text-button" data-gap-reset="${r.id}">Start again</button></div>` : `<div class="actions"><button class="text-button" data-gap-reset="${r.id}">Start again</button></div>`}</div>`;
    return `<div class="gap-result"><strong>${res.verdict === 'adjacent' ? 'Related experience, stated honestly' : 'Drafted from your answers'}</strong><p class="diff-proposed"><span>Proposed bullet</span>${esc(res.bullet)}</p><p class="hint">${esc(res.explanation)} Edit it in CV studio after adding.</p><div class="actions"><button class="primary" data-gap-add="${r.id}">Add to CV draft</button><button class="text-button" data-gap-reset="${r.id}">Start again</button></div></div>`;
  }
  const choice = (i) => gap.choices?.[i] || '';
  return `<form class="gap-form" data-gap-form="${r.id}">
 ${gap.intro ? `<p class="hint">${esc(gap.intro)}</p>` : ''}
 ${gap.questions.map((q, i) => `<fieldset class="gap-q" data-gap-q="${i}">
  <legend>${esc(q)}</legend>
  <div class="yesno"><button type="button" class="${choice(i) === 'yes' ? 'on' : ''}" data-gap-choice="yes">Yes</button><button type="button" class="${choice(i) === 'no' ? 'on' : ''}" data-gap-choice="no">No</button></div>
  <textarea data-gap-answer="${i}" maxlength="2000" rows="2" class="${choice(i) === 'yes' ? '' : 'hidden'}" placeholder="One line makes the bullet specific: where, what you did, what happened. Optional.">${esc(gap.answers?.[i] || '')}</textarea>
 </fieldset>`).join('')}
 <p class="hint">Say Yes only where it is true. With a Yes and no detail, the bullet can only use what is already in your CV.</p>
 <div class="actions"><button class="primary" type="submit">Draft my bullet ✧</button><button class="text-button" type="button" data-gap-reset="${r.id}">Cancel</button></div>
</form>`;
}

export function bind({ loadSample, rebind }) {
  $('#sample')?.addEventListener('click', loadSample);

  const readForm = () => {
    const cv = $('#cv').value.trim(), jd = $('#jd').value.trim();
    if (!cv || !jd) { toast('Add both your CV and the job description.'); return null; }
    return { cv, jd };
  };
  const showResults = (scroll = true) => { $('#results').innerHTML = results(); rebind('#results'); bindGaps(); if (scroll) $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' }); };

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
      const score = evidenceScore(result.requirements);
      toast(score ? `Evidence Score ${score.score}. ${score.gap} requirement${score.gap === 1 ? '' : 's'} missing.` : 'No requirements found.');
    });
  };

  $('#match-form')?.addEventListener('submit', (e) => { e.preventDefault(); if ($('#match-ai')) runAI($('#match-ai')); else runLocal(); });
  if ($('#match-ai')) $('#match-local').onclick = runLocal;

  // ---- Gap Interview ----
  const gapsOf = () => requirements().filter((r) => r.status !== 'evidence');
  const bindGaps = () => {
    $$('[data-gap-start]').forEach((b) => (b.onclick = async () => {
      const r = requirements().find((x) => x.id === b.dataset.gapStart);
      if (!(await api.ensureConsent())) return;
      await busy(b, 'Thinking…', async () => {
        const res = await api.gapQuestions({ cv: state.cv, jd: state.jd, requirement: r });
        state.gaps[r.id] = { intro: res.intro, questions: res.questions, answers: [], result: null }; save();
        showResults(false);
        $(`[data-gap-form="${r.id}"] textarea`)?.focus();
      });
    }));
    $$('[data-gap-choice]').forEach((b) => (b.onclick = () => {
      const fs = b.closest('[data-gap-q]'), i = Number(fs.dataset.gapQ), id = fs.closest('[data-gap-form]').dataset.gapForm;
      const gap = state.gaps[id]; gap.choices = gap.choices || [];
      gap.choices[i] = b.dataset.gapChoice; save();
      $$('[data-gap-choice]', fs).forEach((x) => x.classList.toggle('on', x === b));
      const ta = $('[data-gap-answer]', fs); ta.classList.toggle('hidden', b.dataset.gapChoice !== 'yes'); if (b.dataset.gapChoice === 'yes') ta.focus();
    }));
    $$('[data-gap-form]').forEach((form) => (form.onsubmit = async (e) => {
      e.preventDefault();
      const id = form.dataset.gapForm, r = requirements().find((x) => x.id === id), gap = state.gaps[id];
      gap.answers = $$('[data-gap-answer]', form).map((t) => t.value); save();
      const choices = gap.choices || [];
      if (!choices.some(Boolean)) { toast('Answer Yes or No to at least one question.'); return; }
      if (!choices.includes('yes')) { toast('All No — nothing to add for this requirement, and that is fine.'); gap.result = { verdict: 'unsupported', bullet: '', explanation: 'You answered No to every question, so there is nothing truthful to add here.', learning_line: `Currently developing ${r.name}.` }; save(); showResults(false); return; }
      // Send the model a clear Yes/No plus any detail; "No" answers carry no text to draft from.
      const answers = gap.questions.map((q, i) => choices[i] === 'yes' ? `Yes.${gap.answers[i]?.trim() ? ' ' + gap.answers[i].trim() : ' (no further detail given — use only facts already in the CV)'}` : 'No.');
      await busy($('button[type="submit"]', form), 'Drafting…', async () => {
        const res = await api.gapBullet({ cv: state.cv, requirement: r, questions: gap.questions, answers, otherGaps: gapsOf().filter((g) => g.id !== id) });
        gap.result = res; save();
        showResults(false);
      });
    }));
    $$('[data-gap-reset]').forEach((b) => (b.onclick = () => { delete state.gaps[b.dataset.gapReset]; save(); showResults(false); }));
    const addLine = (id, line, status, note) => {
      const r = state.requirements.find((x) => x.id === id);
      const draft = currentDraft();
      setDraft(draft.replace(/\s*$/, '') + '\n' + line);
      r.evidence = line; r.status = status; r.note = note;
      state.gaps[id].result.added = true; state.suggestions = null; save();
      showResults(false);
    };
    $$('[data-gap-add]').forEach((b) => (b.onclick = () => {
      const id = b.dataset.gapAdd, res = state.gaps[id].result;
      addLine(id, res.bullet, res.verdict === 'adjacent' ? 'partial' : 'evidence', 'Added from your Gap Interview answers. It now appears at the end of your CV draft — move it under the right role in CV studio.');
      toast('Bullet added to your draft. Your Evidence Score has been updated.');
    }));
    $$('[data-gap-learning]').forEach((b) => (b.onclick = () => {
      const id = b.dataset.gapLearning, res = state.gaps[id].result;
      addLine(id, res.learning_line, 'partial', 'Stated as a learning goal, not experience.');
      toast('Learning goal added to the end of your draft.');
    }));
  };
  bindGaps();

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
      status.textContent = `${file.name} loaded. Review the text above, then scan.`;
    } catch (error) {
      if (input.isConnected) { status.textContent = error.message; toast(error.message); }
    } finally {
      input.disabled = false; area.readOnly = false; buttons.forEach((b) => (b.disabled = false));
      status.removeAttribute('aria-busy'); input.value = '';
    }
  });
}
