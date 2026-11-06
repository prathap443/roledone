import { state, session, requirements, save } from '../state.js';
import { questions as templates, feedback as heuristic } from '../core.js';
import { $, $$, esc, heading, empty, busy, locked, toast } from '../ui.js';
import { can, needs } from '../plans.js';
import * as api from '../api.js';

const LEVELS = { screening: 'Recruiter screen', technical: 'Technical interview', senior: 'Senior panel' };
const TYPE_LABEL = { depth: 'DEPTH', gap: 'GAP', behavioural: 'BEHAVIOURAL', scenario: 'SCENARIO' };

/** Current question set: AI-written when available, otherwise templates in the same shape. */
function questionSet() {
  if (state.questions?.length) return state.questions;
  return templates(requirements()).map((prompt, i) => ({ id: `t${i + 1}`, prompt, type: i === 3 ? 'gap' : i === 4 ? 'behavioural' : 'depth', focus: '', why: '', listen_for: [] }));
}

export function render() {
  if (!state.cv || !state.jd) {
    return heading('03 / GET READY', 'Your interview starts here.', 'Practise explaining your work, one question at a time.')
      + empty('Make it relevant to you', 'Add a CV and job description to build a practice session.', 'match', 'Match a role');
  }
  if (!can('questions')) {
    return heading('03 / GET READY', 'Preparation, without the pressure.', 'Questions written for this role and this CV.')
      + `<section class="panel">${locked({ plan: needs('questions'), title: 'Interview questions written for this role', body: `${api.aiAvailable() ? api.providerLabel() : 'Roledone'} writes questions from the actual requirements and your actual CV: depth on what you have, honest probes on what is missing, and a behavioural question from the advert. Then reviews your answers for structure.` })}</section>`;
  }
  const ai = api.aiAvailable();
  if (ai && !state.questions?.length) {
    return heading('03 / GET READY', 'Preparation, without the pressure.', 'Questions written for this role and your CV.') + `
<section class="panel writing"><span class="spinner" aria-hidden="true"></span> <strong>Writing ${state.questionCount || 5} ${LEVELS[state.questionLevel || 'technical'].toLowerCase()} questions from the job description and your CV…</strong><p class="hint">Usually 10–30 seconds. You can carry on elsewhere; they will be here when you come back.</p></section>`;
  }
  const qs = questionSet();
  const q = Math.min(session.question, qs.length - 1);
  const cur = qs[q];
  const fb = state.feedback[q];
  return heading('03 / GET READY', 'Preparation, without the pressure.', state.questions ? `${qs.length} questions written for this role and your CV.` : 'Five template questions shaped by your role match.') + `
<div class="notice">${ai
    ? `Questions are generated from the requirements and your CV. ${api.providerLabel()} reviews the structure of your answer, not its technical correctness, your confidence, or hiring readiness.`
    : 'Practice mode: questions use templates and feedback uses a structure checklist. Technical accuracy, confidence, and hiring readiness are not assessed.'}</div>
<section class="panel">
 ${ai ? `<div class="question-toolbar">
  <div class="toolbar-fields">
   <label class="field inline">Interview stage<select id="level">${Object.entries(LEVELS).map(([k, v]) => `<option value="${k}" ${state.questionLevel === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
   <label class="field inline">How many<select id="count">${[5, 10, 25].map((n) => `<option value="${n}" ${Number(state.questionCount) === n ? 'selected' : ''}>${n} questions${n === 25 ? ' (full round)' : ''}</option>`).join('')}</select></label>
  </div>
  <button class="${state.questions ? 'secondary' : 'primary lime'}" id="generate">${state.questions ? 'Write a new set ✧' : 'Write questions for this role ✧'}</button>
 </div>` : ''}
 <div class="question-dots ${qs.length > 10 ? 'dense' : ''}" aria-label="Choose a question">${qs.map((x, i) => `<button data-question="${i}" class="${i === q ? 'selected' : ''} ${state.answers[i]?.trim() ? 'answered' : ''}" aria-label="Question ${i + 1}: ${esc(x.type)}" title="${esc(TYPE_LABEL[x.type] || '')}${x.focus ? ' · ' + esc(x.focus) : ''}" ${i === q ? 'aria-current="step"' : ''}>${i + 1}</button>`).join('')}</div>
 ${qs.length > 5 ? `<p class="hint progress">${Object.values(state.answers).filter((a) => a?.trim()).length} of ${qs.length} answered · ${['depth', 'scenario', 'gap', 'behavioural'].map((t) => `${qs.filter((x) => x.type === t).length} ${TYPE_LABEL[t].toLowerCase()}`).join(' · ')}</p>` : ''}
 <span class="question-number">QUESTION ${String(q + 1).padStart(2, '0')} / ${String(qs.length).padStart(2, '0')}${cur.type ? ` · ${TYPE_LABEL[cur.type]}` : ''}${cur.focus ? ` · ${esc(cur.focus.toUpperCase())}` : ''}</span>
 <h2 class="question-title">${esc(cur.prompt)}</h2>
 ${cur.why ? `<p class="hint why">${esc(cur.why)}</p>` : ''}
 <label class="field">Your practice answer<textarea id="answer" maxlength="20000" placeholder="Set the scene. Explain your action. Share the outcome…">${esc(state.answers[q] || '')}</textarea><small>Use a real example. It is fine to explain where your experience ends.</small></label>
 <div class="actions"><button class="primary" id="review">${ai ? 'Review my answer ✧' : 'Review answer structure ✧'}</button><button class="secondary" id="next-question">${q === qs.length - 1 ? 'Back to first question' : 'Next question'} →</button></div>
 <div id="feedback">${renderFeedback(fb, cur)}</div>
</section>`;
}

function renderFeedback(fb, cur) {
  if (!fb) return '';
  const listen = cur.listen_for?.length ? `<h4>A strong answer usually covers</h4><ul>${cur.listen_for.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : '';
  if (fb.kind === 'heuristic') return `<div class="feedback"><strong>Structure check</strong><ul>${fb.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>${listen}</div>`;
  const f = fb.feedback;
  const cell = (key, label) => `<div class="star-cell ${f.star[key].present ? 'present' : 'missing'}"><span>${f.star[key].present ? '✓' : '○'} ${label}</span><p>${esc(f.star[key].note)}</p></div>`;
  return `<div class="feedback ai">
 <strong>${api.providerLabel()} review</strong>
 ${f.summary ? `<p>${esc(f.summary)}</p>` : ''}
 <div class="star-grid">${cell('situation', 'Situation')}${cell('task', 'Task')}${cell('action', 'Action')}${cell('result', 'Result')}</div>
 ${f.strengths.length ? `<h4>What works</h4><ul>${f.strengths.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
 ${f.improvements.length ? `<h4>Make it stronger</h4><ul>${f.improvements.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
 ${listen}
 ${f.follow_up ? `<p class="follow-up"><span>A good interviewer would ask next</span> “${esc(f.follow_up)}”</p>` : ''}
</div>`;
}

export function bind({ render: rerender }) {
  if (!can('questions') || !state.cv || !state.jd) return;
  if (api.aiAvailable() && !state.questions?.length) {
    // Prefetch from the role match may still be running; otherwise start now. Re-render when it lands.
    api.generateQuestions().then((qs) => { if (session.page === 'interview') { if (qs) rerender(); else toast('Could not write questions. Try again from the Interview room.'); } });
    return;
  }
  const qs = questionSet();
  const q = Math.min(session.question, qs.length - 1);
  $$('[data-question]').forEach((b) => (b.onclick = () => { session.question = Number(b.dataset.question); rerender(); }));
  $('#next-question')?.addEventListener('click', () => { session.question = (q + 1) % qs.length; rerender(); });
  $('#answer')?.addEventListener('input', (e) => { state.answers[q] = e.target.value; save(); });
  $('#level')?.addEventListener('change', (e) => { state.questionLevel = e.target.value; save(); });
  $('#count')?.addEventListener('change', (e) => { state.questionCount = Number(e.target.value); save(); });

  $('#generate')?.addEventListener('click', async (e) => {
    const button = e.currentTarget;
    if (!(await api.ensureConsent())) return;
    const count = Number(state.questionCount) || 5;
    await busy(button, count > 10 ? 'Writing a full round, this takes a moment…' : 'Writing questions…', async () => {
      const qs = await api.generateQuestions({ level: state.questionLevel, count, force: true });
      if (!qs) { toast('No questions came back. Try again.'); return; }
      rerender();
      toast(`${qs.length} questions written for the ${LEVELS[state.questionLevel].toLowerCase()}.`);
    });
  });

  $('#review')?.addEventListener('click', async (e) => {
    const button = e.currentTarget;
    const answer = $('#answer').value;
    const show = (fb) => { state.feedback[q] = fb; save(); $('#feedback').innerHTML = renderFeedback(fb, qs[q]); };
    if (!api.aiAvailable() || answer.trim().split(/\s+/).length < 8) { show({ kind: 'heuristic', tips: heuristic(answer) }); return; }
    if (!(await api.ensureConsent())) return;
    await busy(button, 'Reviewing…', async () => {
      const result = await api.feedback({ question: qs[q].prompt, answer, cv: state.cv });
      show({ kind: 'ai', feedback: result.feedback });
    });
  });
}
