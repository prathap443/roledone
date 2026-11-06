// Apply the edited CV draft back onto the user's original .docx, preserving its design.
//
// Approach: the draft started life as the text mammoth extracted from this document, one line per
// paragraph. We diff draft lines against the original lines, map original lines to <w:p> elements in
// word/document.xml, and then: replace text inside a paragraph (keeping its first run's formatting),
// insert new paragraphs by cloning a neighbour's XML, and remove deleted paragraphs. Pure string work
// on the XML; no DOM parser needed and nothing leaves the browser.

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(n)).replace(/&amp;/g, '&');
const encode = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const norm = (s) => s.replace(/^[•\-–—*▪◦●>]\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();
const BULLET = /^[•\-–—*▪◦●>]\s*/;

/** Every paragraph in the document body, in order, with its visible text. */
export function paragraphs(xml) {
  const out = [];
  const re = /<w:p\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/w:p>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const p = m[0];
    const text = p.endsWith('/>') ? '' : decode((p.match(/<w:t\b[^>]*>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>/g) || []).map((t) => (t === '<w:tab/>' ? '\t' : t === '<w:br/>' ? '\n' : t.replace(/<w:t\b[^>]*>|<\/w:t>/g, ''))).join(''));
    out.push({ start: m.index, end: m.index + p.length, xml: p, text, hasNum: /<w:numPr>/.test(p) });
  }
  return out;
}

/** Longest-common-subsequence diff of two string arrays (already normalised). Returns ops. */
export function diffLines(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { ops.push({ type: 'equal', a: i, b: j }); i++; j++; }
    else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) { ops.push({ type: 'delete', a: i }); i++; } // delete first so delete+insert pairs into replace
    else { ops.push({ type: 'insert', b: j, after: i - 1 }); j++; }
  }
  // Pair a delete immediately followed by an insert into a replace (keeps the paragraph's formatting).
  const merged = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].type === 'delete' && ops[k + 1]?.type === 'insert') { merged.push({ type: 'replace', a: ops[k].a, b: ops[k + 1].b }); k++; }
    else merged.push(ops[k]);
  }
  return merged;
}

/** Replace all visible text in a paragraph with `text`, keeping the first text run's formatting. */
export function setParagraphText(pXml, text) {
  if (pXml.endsWith('/>')) return pXml; // empty paragraph; caller should clone instead
  const runs = [...pXml.matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)].filter((r) => /<w:t\b/.test(r[0]));
  const t = `<w:t xml:space="preserve">${encode(text)}</w:t>`;
  if (!runs.length) return pXml.replace(/<\/w:p>$/, `<w:r>${t}</w:r></w:p>`);
  let out = pXml;
  // Remove every text run except the first, from the end so offsets stay valid.
  for (let k = runs.length - 1; k >= 1; k--) out = out.slice(0, runs[k].index) + out.slice(runs[k].index + runs[k][0].length);
  const first = runs[0];
  const stripped = first[0].replace(/<w:t\b[^>]*>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>/g, '');
  const rewritten = stripped.replace(/<\/w:r>$/, `${t}</w:r>`);
  return out.slice(0, first.index) + rewritten + out.slice(first.index + first[0].length);
}

const insideTableCell = (xml, pos) => {
  const before = xml.slice(0, pos);
  return (before.match(/<w:tc\b/g) || []).length > (before.match(/<\/w:tc>/g) || []).length;
};

/**
 * Produce a new document.xml with the draft applied.
 * @returns {{xml:string, replaced:number, inserted:number, deleted:number, unmatched:string[]}}
 */
export function applyDraft(xml, originalText, draftText) {
  const ps = paragraphs(xml);
  const nonEmpty = ps.map((p, i) => ({ ...p, i })).filter((p) => p.text.trim());
  const origLines = originalText.split('\n').map((l) => l.trim()).filter(Boolean);
  const draftLines = draftText.split('\n').map((l) => l.trim()).filter(Boolean);

  // Map each original line to a paragraph, walking forward so repeated lines map in order.
  const lineToP = new Array(origLines.length).fill(-1);
  let cursor = 0;
  for (let k = 0; k < origLines.length; k++) {
    const target = norm(origLines[k]);
    for (let q = cursor; q < nonEmpty.length; q++) if (norm(nonEmpty[q].text) === target) { lineToP[k] = nonEmpty[q].i; cursor = q + 1; break; }
  }

  const ops = diffLines(origLines.map(norm), draftLines.map(norm));
  const edits = []; // {pos, remove:[start,end]?, insertXml?}
  const unmatched = [];
  let replaced = 0, inserted = 0, deleted = 0;
  let lastP = -1; // most recent paragraph index we have an anchor for, in document order
  const ensureBullet = (clone, line) => (clone.hasNum || !BULLET.test(clone.text) ? line.replace(BULLET, '') : line);

  for (const op of ops) {
    if (op.type === 'equal') { if (lineToP[op.a] >= 0) lastP = lineToP[op.a]; continue; }
    if (op.type === 'replace') {
      const pi = lineToP[op.a];
      if (pi < 0) { unmatched.push(draftLines[op.b]); continue; }
      const p = ps[pi];
      edits.push({ start: p.start, end: p.end, xml: setParagraphText(p.xml, ensureBullet(p, draftLines[op.b])) });
      replaced++; lastP = pi; continue;
    }
    if (op.type === 'delete') {
      const pi = lineToP[op.a];
      if (pi < 0) continue;
      const p = ps[pi];
      edits.push(insideTableCell(xml, p.start) ? { start: p.start, end: p.end, xml: setParagraphText(p.xml, '') } : { start: p.start, end: p.end, xml: '' });
      deleted++; continue;
    }
    if (op.type === 'insert') {
      // Clone the nearest preceding mapped paragraph; prefer a bullet paragraph if the new line is a bullet.
      const anchorIdx = op.after >= 0 ? lineToP[op.after] : -1;
      const anchor = anchorIdx >= 0 ? anchorIdx : lastP;
      if (anchor < 0) { unmatched.push(draftLines[op.b]); continue; }
      let clone = ps[anchor];
      if (BULLET.test(draftLines[op.b]) && !clone.hasNum && !BULLET.test(clone.text)) {
        const near = ps.slice(Math.max(0, anchor - 6), anchor).reverse().find((q) => q.hasNum || BULLET.test(q.text));
        if (near) clone = near;
      }
      if (clone.xml.endsWith('/>')) clone = ps.slice(0, anchor).reverse().find((q) => q.text.trim()) || clone;
      const text = ensureBullet(clone, draftLines[op.b]);
      edits.push({ start: ps[anchor].end, end: ps[anchor].end, xml: setParagraphText(clone.xml, text) });
      inserted++;
      // Subsequent inserts in the same run should follow this one: keep anchor by bumping lastP (same index, edits are ordered).
    }
  }
  // Apply from the end of the document backwards so earlier offsets stay valid. Inserts at the same
  // position keep their relative order.
  edits.sort((x, y) => y.start - x.start || y.end - x.end);
  let out = xml;
  // Stable handling of multiple inserts at the same offset: apply in original order among equals.
  const groups = new Map();
  for (const e of edits) { const key = `${e.start}:${e.end}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(e); }
  for (const [, group] of [...groups.entries()].sort((a, b) => Number(b[0].split(':')[0]) - Number(a[0].split(':')[0]))) {
    const { start, end } = group[0];
    const insertion = group.map((e) => e.xml).join('');
    out = out.slice(0, start) + insertion + out.slice(end);
  }
  return { xml: out, replaced, inserted, deleted, unmatched };
}

/** Rewrite the user's .docx bytes with the draft applied. */
export async function applyDraftToDocx(bytes, originalText, draftText, { JSZip = globalThis.JSZip } = {}) {
  if (!JSZip) {
    await new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = '/vendor/jszip/jszip.min.js'; s.onload = resolve; s.onerror = () => reject(new Error('Could not load the document writer.')); document.head.appendChild(s); });
    JSZip = globalThis.JSZip;
  }
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('This Word file has no main document part.');
  const result = applyDraft(await entry.async('string'), originalText, draftText);
  zip.file('word/document.xml', result.xml);
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  return { blob, ...result };
}
