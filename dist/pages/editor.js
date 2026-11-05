import { state, setDraft, requirements, currentDraft, save } from '../state.js';
import { $, $$, esc, heading, empty, toast, busy, download, confirm } from '../ui.js';
import * as api from '../api.js';

export function render() {
  if (!state.cv) {
    return heading('02 / SHAPE YOUR STORY', 'Good work. Clearly told.', 'Your experience is the source of truth.')
      + empty('Bring your experience first', 'Add your CV in Role match to start a draft you can edit and export.', 'match', 'Add your CV');
  }
  const ai = api.aiAvailable();
  return heading('02 / SHAPE YOUR STORY', 'Good work. Clearly told.', 'Your source on the left. Your next draft on the right.') + `
<div class="notice">${ai
    ? `${api.providerLabel()} can propose clearer wording for lines you already have. It is blocked from adding numbers, tools or claims that are not in your CV; anything it cannot support is shown as a question for you instead. You accept or dismiss every change.`
    : 'This is a manual editing studio with writing prompts. AI rewriting is not connected on this server. Keep every claim accurate and add numbers only when you can support them.'}</div>
<div class="two-col">
 <section class="panel editor-source"><h2>The original</h2>
  <label class="field">Source CV<textarea class="editor-area" readonly>${esc(state.cv)}</textarea></label>
  <h3>A stronger bullet starts with a question</h3>
  <ul class="rule-list"><li>What did you build, change, or own?</li><li>Which tools did you actually use?</li><li>Who benefited, and what changed?</li><li>Can you explain the result in an interview?</li></ul>
 </section>
 <section class="panel"><h2>Your next version <span class="tag">YOU’RE THE EDITOR</span></h2>
  <label class="field">Editable CV draft<textarea id="draft" class="editor-area" maxlength="50000">${esc(currentDraft())}</textarea></label>
  <div class="actions">
   ${ai ? '<button class="primary lime" id="suggest">Suggest clearer wording ✧</button>' : ''}
   <button class="${ai ? 'secondary' : 'primary'}" id="export">Export CV · TXT ↓</button>
   <button class="secondary" id="reset-draft">Restore original</button>
  </div>
  <p class="hint">Changes are kept in this tab. Device saving is optional in workspace settings.</p>
 </section>
</div>
<div id="suggestions" class="results">${suggestionsPanel()}</div>`;
}

function suggestionsPanel() {
  if (!state.suggestions) return '';
  const visible = state.suggestions.filter((s) => !state.dismissed.includes(s.id));
  const applied = new Set(state.applied);
  return `<section class="panel">
<div class="section-heading"><h2>${visible.length ? `${visible.length} suggested edit${visible.length > 1 ? 's' : ''}` : 'No suggestions left'}</h2><span>${api.providerLabel().toUpperCase()} · REVIEW EACH ONE</span></div>
${visible.length ? '' : '<p class="hint">Nothing further to propose for this draft. Edit the text and ask again, or export your CV.</p>'}
${visible.map((s) => `<article class="suggestion ${applied.has(s.id) ? 'applied' : ''}" data-suggestion="${s.id}">
 <div class="evidence-top"><h3>${s.requirement ? esc(s.requirement) : 'Clarity'}</h3>${applied.has(s.id) ? '<span class="pill">Applied</span>' : ''}</div>
 <p class="diff-original"><span>Now</span> ${esc(s.original)}</p>
 <p class="diff-proposed"><span>Proposed</span> ${esc(s.proposed)}</p>
 <p class="hint">${esc(s.rationale)}</p>
 ${s.evidence.length ? `<p class="source-quote"><span>Supported by</span> ${s.evidence.map((e) => `“${esc(e)}”`).join(' · ')}</p>` : ''}
 ${s.unsupported.length ? `<div class="unsupported"><strong>Only you can answer</strong><ul>${s.unsupported.map((u) => `<li>${esc(u)}</li>`).join('')}</ul><small>Add these to the line yourself if they are true. The AI will not.</small></div>` : ''}
 <div class="actions">${applied.has(s.id) ? '' : `<button class="primary" data-apply="${s.id}">Apply to draft</button>`}<button class="secondary" data-dismiss="${s.id}">Dismiss</button></div>
</article>`).join('')}
</section>`;
}

export function bind({ rebind }) {
  const draftArea = $('#draft');
  if (!draftArea) return;
  draftArea.addEventListener('input', (e) => setDraft(e.target.value));
  $('#export').onclick = () => download('rolewoven-cv.txt', draftArea.value, 'text/plain');
  $('#reset-draft').onclick = async () => {
    if (await confirm({ title: 'Restore the original CV?', body: 'This replaces your edited draft and clears applied suggestions. Export it first if you want to keep a copy.', action: 'Restore original' })) {
      setDraft(state.cv); state.applied = []; save(); draftArea.value = state.cv; refresh();
    }
  };

  const refresh = () => { $('#suggestions').innerHTML = suggestionsPanel(); bindCards(); rebind('#suggestions'); };

  const bindCards = () => {
    $$('[data-apply]').forEach((b) => (b.onclick = () => {
      const s = state.suggestions.find((x) => x.id === b.dataset.apply);
      const draft = draftArea.value;
      const at = draft.indexOf(s.original);
      if (at < 0) { toast('That line has changed since the suggestion was made. Ask for suggestions again.'); return; }
      const next = draft.slice(0, at) + s.proposed + draft.slice(at + s.original.length);
      draftArea.value = next; setDraft(next);
      state.applied.push(s.id); save();
      refresh();
      toast('Applied. Read the line once more in context.');
    }));
    $$('[data-dismiss]').forEach((b) => (b.onclick = () => { state.dismissed.push(b.dataset.dismiss); save(); refresh(); }));
  };
  bindCards();

  $('#suggest')?.addEventListener('click', async (e) => {
    if (!(await api.ensureConsent())) return;
    await busy(e.currentTarget, 'Reading your draft…', async () => {
      const result = await api.suggestions({ cv: state.cv, draft: draftArea.value, jd: state.jd, requirements: requirements() });
      state.suggestions = result.suggestions; state.dismissed = []; state.applied = []; save();
      refresh();
      $('#suggestions').scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast(result.suggestions.length ? `${result.suggestions.length} suggestion${result.suggestions.length > 1 ? 's' : ''} ready to review.` : 'No changes proposed for this draft.');
    });
  });
}
