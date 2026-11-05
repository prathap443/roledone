import { state, save } from '../state.js';
import { $, $$, esc, heading, toast, confirm } from '../ui.js';

const STATUSES = ['Preparing', 'Applied', 'Interview', 'Offer', 'Closed'];

export function render() {
  return heading('04 / LEARN AS YOU GO', 'Every application is a next step.', 'Track what happened. Look for patterns without guessing why.') + `
<section class="panel"><h2>Add an opportunity</h2>
 <form id="application-form"><div class="two-col">
  <label class="field">Role title<input id="role" required maxlength="120" placeholder="Senior Data Engineer"></label>
  <label class="field">Company<input id="company" required maxlength="120" placeholder="Company name"></label>
 </div><button class="primary" type="submit">Add application +</button></form>
</section>
<section class="panel results">
 <div class="section-heading"><h2>Your opportunities</h2><span>${state.applications.length} TRACKED</span></div>
 ${state.applications.length ? state.applications.map((a) => `<article class="application">
  <div><h3>${esc(a.role)}</h3><p>${esc(a.company)} · Added ${esc(a.date)}</p></div>
  <label><span class="hint">Status</span><select data-status="${esc(a.id)}" aria-label="Application status for ${esc(a.role)}">${STATUSES.map((s) => `<option ${a.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
  <button data-delete="${esc(a.id)}" aria-label="Delete application for ${esc(a.role)}">×</button>
 </article>`).join('') : '<div class="empty"><div class="empty-icon">↗</div><h3>Your next chapter is unwritten.</h3><p>Add your first opportunity above. No invented activity, just your progress.</p></div>'}
</section>
<p class="hint">Statuses are self-reported. Application outcomes alone cannot explain rejection causes.</p>`;
}

export function bind({ render: rerender }) {
  $('#application-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const role = $('#role').value.trim(), company = $('#company').value.trim();
    if (!role || !company) { toast('Enter a role and company.'); return; }
    state.applications.unshift({ id: crypto.randomUUID(), role, company, status: 'Preparing', date: new Date().toLocaleDateString('en-GB') });
    save(); rerender(); toast('Opportunity added.');
  });
  $$('[data-status]').forEach((s) => (s.onchange = () => { state.applications.find((a) => a.id === s.dataset.status).status = s.value; save(); toast('Status updated.'); }));
  $$('[data-delete]').forEach((b) => (b.onclick = async () => {
    if (await confirm({ title: 'Remove this opportunity?', body: 'This deletes the record from your workspace.', action: 'Remove opportunity' })) {
      state.applications = state.applications.filter((a) => a.id !== b.dataset.delete); save(); rerender();
    }
  }));
}
