import { state, session, requirements, save } from '../state.js';
import { questions as templates, feedback as heuristic } from '../core.js';
import { $, $$, esc, heading, empty, busy, locked, toast, confirm } from '../ui.js';
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
  if (state.mock && !state.mock.finished) return heading('03 / GET READY', 'Mock session in progress.', 'One question at a time, against the clock. No feedback until the end.') + renderMock(qs);
  if (state.mock?.finished && !state.mock.dismissed) return heading('03 / GET READY', 'Your mock session debrief.', 'How the whole session read, and what to practise next.') + renderMock(qs);
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
  ${state.questions ? (can('mock') ? '<button class="secondary" id="start-mock">⏱ Timed mock session</button>' : '<button class="secondary premium-cta" data-upgrade title="Premium">⏱ Timed mock session · Premium</button>') : ''}
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
 ${f.follow_up ? `<p class="follow-up"><span>A good interviewer would ask next</span> “${esc(f.follow_up)}”</p>${followUpThread(f.follow_up)}` : ''}
</div>`;
}

const MAX_FOLLOW_UPS = 3;
/** Premium: answer the follow-up, get it reviewed, and keep going up to three levels. */
function followUpThread(firstFollowUp) {
  const q = Math.min(session.question, questionSet().length - 1);
  const thread = state.followUps[q] || [];
  if (!can('followUps')) return `<div class="follow-thread locked-inline"><p>Answer the follow-up and get it reviewed — three levels deep, like a real panel.</p><button class="secondary small" data-upgrade>Unlock with Premium</button></div>`;
  const steps = thread.map((t, i) => `<div class="follow-step"><span class="follow-label">FOLLOW-UP ${i + 1}</span><p class="follow-q">“${esc(t.question)}”</p>
   ${t.feedback ? `<p class="follow-a">${esc(t.answer)}</p><div class="follow-fb">${t.feedback.summary ? `<p>${esc(t.feedback.summary)}</p>` : ''}${t.feedback.improvements?.length ? `<ul>${t.feedback.improvements.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`
    : `<label class="field">Your answer<textarea class="follow-answer" data-follow="${i}" maxlength="20000" placeholder="Go one level deeper: the trade-off, the number, what you would change…">${esc(t.answer || '')}</textarea></label><div class="actions"><button class="primary small" data-review-follow="${i}">Review follow-up ✧</button></div>`}
  </div>`).join('');
  const last = thread[thread.length - 1];
  const nextQ = thread.length ? last?.feedback?.follow_up : firstFollowUp;
  const canAdd = thread.length < MAX_FOLLOW_UPS && (!last || last.feedback) && nextQ;
  const done = thread.length && last?.feedback && (!nextQ || thread.length >= MAX_FOLLOW_UPS);
  return `<div class="follow-thread">${steps}${canAdd ? `<button class="secondary small" id="answer-follow" data-q="${esc(nextQ)}">${thread.length ? 'Answer the next follow-up' : 'Answer this follow-up'} →</button>` : ''}${done ? '<p class="hint">Thread complete. A panel rarely goes deeper than this.</p>' : ''}</div>`;
}

/* ---------------- Timed mock session (Premium) ---------------- */
const MOCK_SECONDS = 120;
const MOCK_SIZE = 6;

function pickMockQuestions(qs) {
  if (qs.length <= MOCK_SIZE) return qs.map((_, i) => i);
  const byType = { gap: [], scenario: [], behavioural: [], depth: [] };
  qs.forEach((x, i) => (byType[x.type] || byType.depth).push(i));
  const out = [];
  while (out.length < MOCK_SIZE) { let added = false; for (const t of ['depth', 'gap', 'scenario', 'behavioural']) { const i = byType[t].shift(); if (i != null && out.length < MOCK_SIZE) { out.push(i); added = true; } } if (!added) break; }
  return out.sort((a, b) => a - b);
}

function renderMock(qs) {
  const m = state.mock;
  if (!m.finished) {
    const it = m.items[m.current];
    return `<section class="panel mock">
 <div class="mock-top"><span class="question-number">MOCK · QUESTION ${String(m.current + 1).padStart(2, '0')} / ${String(m.items.length).padStart(2, '0')}${it.type ? ` · ${TYPE_LABEL[it.type]}` : ''}</span><span class="mock-timer" id="mock-timer" aria-live="polite">${MOCK_SECONDS}s</span></div>
 <div class="mock-bar"><i id="mock-bar"></i></div>
 <h2 class="question-title">${esc(it.prompt)}</h2>
 <label class="field">Answer out loud, then jot the key points<textarea id="mock-answer" maxlength="20000" placeholder="Situation · Task · Action · Result">${esc(it.answer || '')}</textarea></label>
 <div class="actions"><button class="primary" id="mock-next">${m.current === m.items.length - 1 ? 'Finish session' : 'Next question'} →</button><button class="text-button" id="mock-abandon">Abandon session</button></div>
 <p class="hint">Two minutes per question. When the clock runs out you move on automatically — just like a real panel.</p>
</section>`;
  }
  const d = m.debrief;
  const verdictClass = { strong: 'ok', okay: 'mid', weak: 'warn', skipped: 'muted' };
  return `<section class="panel mock-debrief">
 ${d ? `<div class="debrief-head"><div class="score-ring-wrap"><div class="score-ring ${d.score >= 70 ? 'strong' : d.score >= 45 ? 'developing' : 'early'}" style="--target:${d.score}"></div><div class="score-label"><strong>${d.score}</strong><span>READINESS</span></div></div>
  <div><span class="eyebrow">${esc(LEVELS[m.level] || 'Technical interview').toUpperCase()} · ${m.items.length} QUESTIONS · ${Math.max(1, Math.round((m.endedAt - m.startedAt) / 60000))} MIN</span><h2>${esc(d.overall)}</h2></div></div>
 ${d.priorities.length ? `<h3>Practise next</h3><ol class="priorities">${d.priorities.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
 <h3>Question by question</h3>
 <ol class="debrief-list">${m.items.map((it, i) => { const pq = d.per_question.find((x) => x.index === i); return `<li><span class="pill ${verdictClass[pq?.verdict] || 'muted'}">${esc(pq?.verdict || (it.answer?.trim() ? 'okay' : 'skipped'))}</span><div><p class="follow-q">${esc(it.prompt)}</p>${it.answer?.trim() ? `<p class="follow-a">${esc(it.answer)}</p>` : '<p class="hint">No answer in time.</p>'}${pq?.note ? `<p class="debrief-note">${esc(pq.note)}</p>` : ''}</div></li>`; }).join('')}</ol>
 ${d.model_answer ? `<h3>One answer, restructured</h3><p class="hint">“${esc(m.items[d.model_answer.index]?.prompt || '')}” — rebuilt in STAR form from what you said and your CV. Square brackets mark facts only you can add.</p><blockquote class="model-answer">${esc(d.model_answer.answer)}</blockquote>` : ''}`
   : `<h2>Session complete.</h2><p>${m.items.filter((x) => x.answer?.trim()).length} of ${m.items.length} answered. Get the debrief: an overall read, a note on every answer, and one answer rebuilt in STAR form.</p>`}
 <div class="actions">${d ? '' : '<button class="primary lime" id="mock-debrief">Get my debrief ✧</button>'}<button class="secondary" id="mock-keep">Keep answers and return to practice</button><button class="text-button" id="mock-again">Run another session</button></div>
</section>`;
}

export function bind({ render: rerender }) {
  if (!can('questions') || !state.cv || !state.jd) return;
  if (api.aiAvailable() && !state.questions?.length) {
    // Prefetch from the role match may still be running; otherwise start now. Re-render when it lands.
    api.generateQuestions().then((qs) => { if (session.page === 'interview') { if (qs) rerender(); else toast('Could not write questions. Try again from the Interview room.'); } });
    return;
  }
  const qs = questionSet();
  clearInterval(session.mockTimer); session.mockTimer = null;
  if (state.mock && (!state.mock.finished || !state.mock.dismissed)) { bindMock(qs, rerender); return; }
  const q = Math.min(session.question, qs.length - 1);
  $('#start-mock')?.addEventListener('click', async () => {
    if (!(await api.ensureConsent())) return;
    if (Object.values(state.answers).some((a) => a?.trim()) && !(await confirm({ title: 'Start a timed mock session?', body: 'Six questions from this set, two minutes each, no feedback until the end. Your existing practice answers are kept.', action: 'Start' }))) return;
    const picks = pickMockQuestions(qs);
    state.mock = { level: state.questionLevel || 'technical', items: picks.map((i) => ({ index: i, prompt: qs[i].prompt, type: qs[i].type, answer: '' })), current: 0, startedAt: Date.now(), questionStartedAt: Date.now(), finished: false, debrief: null };
    save(); rerender();
  });
  bindFollowUps(qs, q);
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
    const show = (fb) => { state.feedback[q] = fb; save(); $('#feedback').innerHTML = renderFeedback(fb, qs[q]); bindFollowUps(qs, q); };
    if (!api.aiAvailable() || answer.trim().split(/\s+/).length < 8) { show({ kind: 'heuristic', tips: heuristic(answer) }); return; }
    if (!(await api.ensureConsent())) return;
    await busy(button, 'Reviewing…', async () => {
      const result = await api.feedback({ question: qs[q].prompt, answer, cv: state.cv });
      show({ kind: 'ai', feedback: result.feedback });
    });
  });
}


function bindFollowUps(qs, q) {
  const repaint = () => { $('#feedback').innerHTML = renderFeedback(state.feedback[q], qs[q]); bindFollowUps(qs, q); };
  $('#answer-follow')?.addEventListener('click', (e) => { (state.followUps[q] ||= []).push({ question: e.currentTarget.dataset.q, answer: '', feedback: null }); save(); repaint(); $$('.follow-answer').pop()?.focus(); });
  $$('.follow-answer').forEach((t) => t.addEventListener('input', (e) => { state.followUps[q][Number(e.target.dataset.follow)].answer = e.target.value; save(); }));
  $$('[data-review-follow]').forEach((b) => (b.onclick = async (e) => {
    const button = e.currentTarget, i = Number(button.dataset.reviewFollow);
    const t = state.followUps[q][i];
    if (!t.answer || t.answer.trim().split(/\s+/).length < 8) { toast('Write a few sentences first.'); return; }
    if (!(await api.ensureConsent())) return;
    const parent = i === 0 ? { question: qs[q].prompt, answer: state.answers[q] || '' } : { question: state.followUps[q][i - 1].question, answer: state.followUps[q][i - 1].answer };
    await busy(button, 'Reviewing…', async () => {
      const result = await api.feedback({ question: t.question, answer: t.answer, cv: state.cv, parent });
      t.feedback = result.feedback; save(); repaint();
    });
  }));
}

function bindMock(qs, rerender) {
  const m = state.mock;
  if (!m.finished) {
    const area = $('#mock-answer');
    area?.addEventListener('input', (e) => { m.items[m.current].answer = e.target.value; save(); });
    area?.focus();
    const advance = () => {
      clearInterval(session.mockTimer); session.mockTimer = null;
      if (m.current >= m.items.length - 1) { m.finished = true; m.endedAt = Date.now(); }
      else { m.current += 1; m.questionStartedAt = Date.now(); }
      save(); rerender();
    };
    const tick = () => {
      const left = Math.max(0, MOCK_SECONDS - Math.floor((Date.now() - m.questionStartedAt) / 1000));
      const t = $('#mock-timer'), bar = $('#mock-bar');
      if (!t) { clearInterval(session.mockTimer); return; }
      t.textContent = `${left}s`; t.classList.toggle('low', left <= 20);
      if (bar) bar.style.width = `${100 * left / MOCK_SECONDS}%`;
      if (left === 0) advance();
    };
    tick();
    session.mockTimer = setInterval(tick, 1000);
    $('#mock-next').onclick = advance;
    $('#mock-abandon').onclick = async () => { if (await confirm({ title: 'Abandon this session?', body: 'Answers written in the session are discarded.', action: 'Abandon' })) { state.mock = null; save(); rerender(); } };
    return;
  }
  $('#mock-debrief')?.addEventListener('click', async (e) => {
    const button = e.currentTarget;
    await busy(button, 'Reading your session…', async () => {
      const r = await api.mockDebrief({ cv: state.cv, jd: state.jd, level: m.level, items: m.items.map(({ prompt, answer, type }) => ({ prompt, answer, type })) });
      m.debrief = r.debrief; save(); rerender();
    });
  });
  const keep = () => { for (const it of m.items) if (it.answer?.trim() && !state.answers[it.index]?.trim()) state.answers[it.index] = it.answer; m.dismissed = true; save(); rerender(); };
  $('#mock-keep').onclick = keep;
  $('#mock-again').onclick = () => { const picks = pickMockQuestions(qs); state.mock = { level: m.level, items: picks.map((i) => ({ index: i, prompt: qs[i].prompt, type: qs[i].type, answer: '' })), current: 0, startedAt: Date.now(), questionStartedAt: Date.now(), finished: false, debrief: null }; save(); rerender(); };
}
