// Small DOM helpers shared by every page.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
export function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3500);
}

export function modal(html) {
  $('#dialog-content').innerHTML = html;
  $('#dialog').showModal();
}
export const closeModal = () => $('#dialog').close();

/** Confirmation dialog. Resolves true when the primary button is pressed. */
export function confirm({ title, body, action, secondary = 'Cancel' }) {
  return new Promise((resolve) => {
    modal(`<h2>${esc(title)}</h2><p>${body}</p><div class="actions"><button class="primary" id="confirm-yes">${esc(action)}</button><button class="secondary" id="confirm-no">${esc(secondary)}</button></div>`);
    const dialog = $('#dialog');
    const done = (value) => { dialog.removeEventListener('close', onClose); dialog.close(); resolve(value); };
    const onClose = () => { dialog.removeEventListener('close', onClose); resolve(false); };
    dialog.addEventListener('close', onClose);
    $('#confirm-yes').onclick = () => done(true);
    $('#confirm-no').onclick = () => done(false);
  });
}

export function heading(eyebrow, title, description, action = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}

export function empty(title, description, target, label) {
  return `<div class="panel empty"><div class="empty-icon">◎</div><h2>${esc(title)}</h2><p>${esc(description)}</p><button class="primary" data-page="${target}">${esc(label)} ↗</button></div>`;
}

export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Download prepared.');
}

/** Run an async action with a button in a busy state; errors become toasts. */
export async function busy(button, label, action) {
  if (!button || button.disabled) return;
  const original = button.innerHTML;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${esc(label)}`;
  try {
    return await action();
  } catch (error) {
    toast(error.message || 'Something went wrong.');
    if (error.status === 402) document.dispatchEvent(new CustomEvent('roledone:upgrade', { detail: error.code === 'quota' ? { quota: error } : null }));
    return undefined;
  } finally {
    if (button.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); button.innerHTML = original; }
  }
}

export const pill = (status) => ({
  evidence: '<span class="pill">Evidence found</span>',
  partial: '<span class="pill partial">Partial mention</span>',
  gap: '<span class="pill gap">Evidence to clarify</span>',
}[status] || '');

/** Locked-feature panel shown to plans without access. */
export function locked({ title, body, plan, compact = false }) {
  return `<div class="locked ${compact ? 'compact' : ''}"><div class="locked-badge">${esc(plan)}</div><h3>${esc(title)}</h3><p>${esc(body)}</p><button class="primary lime" data-upgrade>See plans ↗</button></div>`;
}
