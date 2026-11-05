import { state, session, requirements, save } from '../state.js';
import { questions, feedback as heuristic } from '../core.js';
import { $, $$, esc, heading, empty, busy } from '../ui.js';
import * as api from '../api.js';

export function render() {
  if (!state.cv || !state.jd) {
    return heading('03 / GET READY', 'Your interview starts here.', 'Practise explaining your work, one question at a time.')
      + empty('Make it relevant to you', 'Add a CV and job description to build a five-question practice session.', 'match', 'Match a role');
  }
  const qs = questions(requirements());
  const q = Math.min(session.question, qs.length - 1);
  const ai = api.aiAvailable();
  return heading('03 / GET READY', 'Preparation, without the pressure.', 'Five questions shaped by the requirements in your role match.') + `
<div class="notice">${ai
    ? `${api.providerLabel()} reviews the structure of your answer: the situation, your task, what you personally did, and the result. It does not assess technical correctness, confidence, or hiring readiness.`
    : 'Practice mode: questions use templates and feedback uses a structure checklist. Technical accuracy, confidence, and hiring readiness are not assessed.'}</div>
<section class="panel">
 <div class="question-dots" aria-label="Choose a question">${qs.map((_, i) => `<button data-question="${i}" class="${i === q ? 'selected' : ''} ${state.answers[i]?.trim() ? 'answered' : ''}" aria-label="Question ${i + 1}" ${i === q ? 'aria-current="step"' : ''}>${i + 1}</button>`).join('')}</div>
 <span class="question-number">QUESTION ${String(q + 1).padStart(2, '0')} / ${String(qs.length).padStart(2, '0')}</span>
 <h2 class="question-title">${esc(qs[q])}</h2>
 <label class="field">Your practice answer<textarea id="answer" maxlength="20000" placeholder="Set the scene. Explain your action. Share the outcome…">${esc(state.answers[q] || '')}</textarea><small>Use a real example. It is fine to explain where your experience ends.</small></label>
 <div class="actions"><button class="primary" id="review">${ai ? 'Review my answer ✧' : 'Review answer structure ✧'}</button><button class="secondary" id="next-question">${q === qs.length - 1 ? 'Back to first question' : 'Next question'} →</button></div>
 <div id="feedback">${renderFeedback(state.feedback[q])}</div>
</section>`;
}

function renderFeedback(fb) {
  if (!fb) return '';
  if (fb.kind === 'heuristic') return `<div class="feedback"><strong>Structure check</strong><ul>${fb.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
  const f = fb.feedback;
  const cell = (key, label) => `<div class="star-cell ${f.star[key].present ? 'present' : 'missing'}"><span>${f.star[key].present ? '✓' : '○'} ${label}</span><p>${esc(f.star[key].note)}</p></div>`;
  return `<div class="feedback ai">
 <strong>${api.providerLabel()} review</strong>
 ${f.summary ? `<p>${esc(f.summary)}</p>` : ''}
 <div class="star-grid">${cell('situation', 'Situation')}${cell('task', 'Task')}${cell('action', 'Action')}${cell('result', 'Result')}</div>
 ${f.strengths.length ? `<h4>What works</h4><ul>${f.strengths.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
 ${f.improvements.length ? `<h4>Make it stronger</h4><ul>${f.improvements.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
 ${f.follow_up ? `<p class="follow-up"><span>A good interviewer would ask next</span> “${esc(f.follow_up)}”</p>` : ''}
</div>`;
}

export function bind({ render: rerender }) {
  const qs = questions(requirements());
  const q = Math.min(session.question, qs.length - 1);
  $$('[data-question]').forEach((b) => (b.onclick = () => { session.question = Number(b.dataset.question); rerender(); }));
  $('#next-question')?.addEventListener('click', () => { session.question = (q + 1) % qs.length; rerender(); });
  $('#answer')?.addEventListener('input', (e) => { state.answers[q] = e.target.value; save(); });

  $('#review')?.addEventListener('click', async (e) => {
    const answer = $('#answer').value;
    const show = (fb) => { state.feedback[q] = fb; save(); $('#feedback').innerHTML = renderFeedback(fb); };
    if (!api.aiAvailable() || answer.trim().split(/\s+/).length < 8) { show({ kind: 'heuristic', tips: heuristic(answer) }); return; }
    if (!(await api.ensureConsent())) return;
    await busy(e.currentTarget, 'Reviewing…', async () => {
      const result = await api.feedback({ question: qs[q], answer, cv: state.cv });
      show({ kind: 'ai', feedback: result.feedback });
    });
  });
}
