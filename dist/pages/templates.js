import { state, currentDraft, save } from '../state.js';
import { structureCV, hashText } from '../structure.js';
import { TEMPLATES, renderTemplate } from '../templates.js';
import { structuredDocxBlob } from '../export.js';
import { $, $$, esc, heading, empty, toast, busy, locked } from '../ui.js';
import { can, needs } from '../plans.js';
import * as api from '../api.js';

/** Structured CV for the current draft: cached by hash, heuristic first, AI refinement when available. */
async function structured({ refine = false } = {}) {
  const draft = currentDraft();
  const hash = hashText(draft);
  if (state.structured?.hash === hash && (!refine || state.structured.ai)) return state.structured.cv;
  let cv = state.structured?.hash === hash ? state.structured.cv : structureCV(draft);
  let ai = state.structured?.hash === hash ? state.structured.ai : false;
  if (refine && api.aiAvailable() && !ai) {
    const res = await api.structure({ cv: draft });
    if (res.structured?.experience?.length || res.structured?.name) { cv = res.structured; ai = true; }
  }
  state.structured = { hash, cv, ai }; save();
  return cv;
}

export function render() {
  if (!state.cv) {
    return heading('02 / CHOOSE A LOOK', 'Your CV, in a template that prints clean.', 'Pick a layout; your draft flows into it.')
      + empty('Add your CV first', 'Scan or match a role to start a draft, then choose a template.', 'scan', 'Scan my CV');
  }
  if (!can('export')) {
    return heading('02 / CHOOSE A LOOK', 'Your CV, in a template that prints clean.', 'Pick a layout; your draft flows into it.')
      + `<section class="panel">${locked({ plan: needs('export'), title: 'Four A4 templates, PDF and Word export', body: 'Standard, Modern, Compact and Minimal. Your draft — including Gap Interview bullets and applied suggestions — flows into every one. Export as PDF or Word.' })}</section>`;
  }
  const cur = TEMPLATES[state.template] ? state.template : 'standard';
  return heading('02 / CHOOSE A LOOK', 'Your CV, in a template that prints clean.', 'Pick a layout on the left. The preview is the exact page you will export.') + `
<div class="templates">
 <aside class="gallery">
  ${Object.entries(TEMPLATES).map(([id, t]) => `<button class="tcard ${id === cur ? 'selected' : ''}" data-template="${id}" aria-pressed="${id === cur}"><div class="thumb"><iframe tabindex="-1" aria-hidden="true" data-thumb="${id}" sandbox=""></iframe></div><strong>${esc(t.label)}</strong><p>${esc(t.blurb)}</p></button>`).join('')}
  <p class="hint">${state.structured?.ai ? 'Sections identified by the AI agent and checked word for word against your draft.' : api.aiAvailable() ? 'Sections identified by rules. <button class="text-button" id="refine">Let the AI agent tidy the sections ✧</button>' : 'Sections identified by rules.'}</p>
 </aside>
 <section class="preview-wrap">
  <div class="preview-bar"><span class="eyebrow">PREVIEW · ${esc(TEMPLATES[cur].label.toUpperCase())}</span><div class="actions"><button class="primary" id="tpl-pdf">Export PDF ↓</button><button class="secondary" id="tpl-docx">Export Word ↓</button><button class="text-button" data-page="editor">← Back to CV studio</button></div></div>
  <div class="preview-frame"><iframe id="preview" title="CV preview" sandbox=""></iframe></div>
  ${cur === 'modern' ? '<p class="hint">Word export of Modern uses a single column; the sidebar layout is PDF only.</p>' : ''}
 </section>
</div>`;
}

export function bind({ render: rerender }) {
  if (!can('export') || !state.cv) return;
  const cur = TEMPLATES[state.template] ? state.template : 'standard';
  const paint = async () => {
    const cv = await structured();
    $('#preview').srcdoc = renderTemplate(cur, cv);
    for (const f of $$('[data-thumb]')) f.srcdoc = renderTemplate(f.dataset.thumb, cv);
  };
  paint();
  $$('[data-template]').forEach((b) => (b.onclick = () => { state.template = b.dataset.template; save(); rerender(); }));
  $('#refine')?.addEventListener('click', async (e) => {
    const button = e.currentTarget;
    if (!(await api.ensureConsent())) return;
    await busy(button, 'Reading your draft…', async () => { await structured({ refine: true }); rerender(); toast('Sections tidied.'); });
  });
  $('#tpl-pdf').onclick = () => {
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups for this site to print.'); return; }
    w.document.write($('#preview').srcdoc); w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 500);
    toast('Choose “Save as PDF” in the print dialog.');
  };
  $('#tpl-docx').onclick = (e) => busy(e.currentTarget, 'Building…', async () => {
    const blob = await structuredDocxBlob(await structured(), cur);
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `roledone-cv-${cur}.docx`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Word document ready.');
  });
}
