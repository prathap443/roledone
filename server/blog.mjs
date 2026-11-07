// Server-rendered blog: markdown files in content/blog/ become /blog and /blog/<slug>.
// No dependencies. Posts are read once at startup (and re-read when ROLEDONE_BLOG_RELOAD=1 for authoring).

import { readFile, readdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Parse a `---` frontmatter block: simple key: value pairs, comma lists for tags. */
export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim(), value = line.slice(i + 1).trim().replace(/^"|"$/g, '');
    meta[key] = key === 'tags' ? value.split(',').map((t) => t.trim()).filter(Boolean) : value;
  }
  return { meta, body: text.slice(m[0].length) };
}

/** Inline markdown: code, bold, italic, links. Escapes HTML first, so posts cannot inject markup. */
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*|#[^)\s]*)\)/g, (_, t, u) => `<a href="${u}"${u.startsWith('http') ? ' rel="noopener" target="_blank"' : ''}>${t}</a>`);
}

/** Block-level markdown → HTML. Headings, paragraphs, ul/ol, fenced code, blockquote, hr. */
export function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const lang = line.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code${lang ? ` class="lang-${esc(lang)}"` : ''}>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.+)$/);
    if (h) { flush(); const level = h[1].length + 1; const id = h[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); out.push(`<h${level} id="${id}">${inline(h[2])}</h${level}>`); i++; continue; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flush(); out.push('<hr>'); i++; continue; }
    if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      flush();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const head = cells(line); i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(q.join('\n'))}</blockquote>`);
      continue;
    }
    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
        if (!m || /\d/.test(m[2]) !== ordered) break;
        let item = m[3]; i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s/.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    para.push(line.trim()); i++;
  }
  flush();
  return out.join('\n');
}

const readingTime = (body) => Math.max(1, Math.round(body.split(/\s+/).length / 220));

export async function loadPosts(dir) {
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md')).sort();
  const posts = [];
  for (const f of files) {
    const { meta, body } = parseFrontmatter(await readFile(resolve(dir, f), 'utf8'));
    if (!meta.title || !meta.date) throw new Error(`content/blog/${f}: frontmatter needs title and date`);
    posts.push({ slug: meta.slug || basename(f, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, ''), title: meta.title, description: meta.description || '', date: meta.date, tags: meta.tags || [], level: meta.level || '', minutes: readingTime(body), html: renderMarkdown(body) });
  }
  return posts.sort((a, b) => (a.date < b.date ? 1 : -1));
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@600;700;800&display=swap');
:root{--paper:#f7f8f2;--ink:#192c26;--muted:#6b746c;--line:#e1e5db;--lime:#d8f36a;--green:#355a42}
*{box-sizing:border-box}body{margin:0;font-family:'DM Sans',sans-serif;color:var(--ink);background:radial-gradient(1200px 600px at 8% -10%,#eef3dc 0%,transparent 60%),var(--paper);line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--green)}
.wrap{max-width:760px;margin:0 auto;padding:0 20px}
header.site{display:flex;align-items:center;justify-content:space-between;padding:22px 0}
.brand{display:flex;align-items:center;gap:10px;font-family:'Manrope',sans-serif;font-weight:800;font-size:22px;color:var(--ink);text-decoration:none;letter-spacing:-.5px}
.brand span{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:var(--lime);box-shadow:0 6px 16px -6px rgba(176,214,48,.9)}
header.site nav a{margin-left:18px;font-size:14px;color:var(--muted);text-decoration:none}header.site nav a:hover{color:var(--ink)}
header.site nav a.cta{background:var(--ink);color:#fff;padding:9px 14px;border-radius:999px;font-weight:600}
h1{font-family:'Manrope',sans-serif;font-weight:700;letter-spacing:-1.2px;font-size:clamp(32px,5vw,48px);line-height:1.05;margin:36px 0 12px}
.lede{font-size:18px;color:var(--muted);max-width:60ch;margin:0 0 28px}
.meta{font-size:13px;color:var(--muted);display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.tag{background:#eef3dc;color:#4a5a2a;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600}
.level{border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:12px}
.list{list-style:none;padding:0;margin:24px 0 60px;display:grid;gap:14px}
.card{display:block;background:#fff;border:1px solid #e6e9df;border-radius:18px;padding:22px 24px;text-decoration:none;color:inherit;box-shadow:0 1px 2px rgba(25,44,38,.05),0 14px 36px -18px rgba(25,44,38,.22);transition:transform .18s,box-shadow .18s}
.card:hover{transform:translateY(-2px);box-shadow:0 2px 4px rgba(25,44,38,.06),0 24px 60px -24px rgba(25,44,38,.35)}
.card h2{font-family:'Manrope',sans-serif;font-size:22px;letter-spacing:-.5px;margin:0 0 6px}
.card p{margin:0 0 12px;color:var(--muted)}
article{background:#fff;border:1px solid #e6e9df;border-radius:22px;padding:36px clamp(20px,5vw,48px);margin:28px 0 40px;box-shadow:0 1px 2px rgba(25,44,38,.05),0 14px 36px -18px rgba(25,44,38,.22)}
article h2{font-family:'Manrope',sans-serif;font-size:26px;letter-spacing:-.6px;margin:36px 0 10px}
article h3{font-size:19px;margin:28px 0 8px}
article p,article li{font-size:17px}
article pre{background:#152a23;color:#e8f0e4;padding:18px 20px;border-radius:14px;overflow:auto;font-size:14px;line-height:1.5}
article code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em}
article p code,article li code{background:#eef3dc;padding:2px 6px;border-radius:6px}
article blockquote{margin:20px 0;padding:14px 20px;border-left:4px solid var(--lime);background:#fbfdf4;border-radius:0 12px 12px 0}
article blockquote p{margin:0}
article hr{border:0;border-top:1px solid var(--line);margin:32px 0}
article table{border-collapse:collapse;width:100%;margin:18px 0;font-size:15px}
article th,article td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
article th{font-weight:600;background:#f3f6ec}
.next{background:linear-gradient(135deg,#223c32 0%,#13241d 100%);color:#fff;border-radius:22px;padding:30px clamp(20px,5vw,40px);margin:0 0 60px;box-shadow:0 24px 60px -24px rgba(25,44,38,.5)}
.next h2{font-family:'Manrope',sans-serif;margin:0 0 8px;letter-spacing:-.6px}
.next p{color:#c9d6c5;margin:0 0 18px;max-width:56ch}
.next a{display:inline-block;background:var(--lime);color:var(--ink);font-weight:700;text-decoration:none;padding:12px 18px;border-radius:12px}
footer{color:var(--muted);font-size:13px;padding:0 0 40px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
@media(max-width:540px){header.site nav a{margin-left:12px}article{padding:26px 18px}article p,article li{font-size:16px}}
`;

function layout({ title, description, body, canonical, jsonLd = null }) {
  return `<!doctype html><html lang="en-GB"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#192c26">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(canonical)}"><link rel="icon" href="/mark.svg" type="image/svg+xml">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:type" content="article"><meta property="og:url" content="${esc(canonical)}">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
<style>${CSS}</style></head><body><div class="wrap">
<header class="site"><a class="brand" href="/"><span>↗</span>roledone</a><nav><a href="/blog">Learn</a><a href="/#scan">Scan my CV</a><a class="cta" href="/#match">Open the app</a></nav></header>
${body}
<footer><span>Roledone — an evidence-first career studio for tech professionals.</span><span><a href="/blog">Learn</a> · <a href="/">App</a></span></footer>
</div></body></html>`;
}

const fmtDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function createBlog({ posts, siteUrl = 'https://roledone.com' }) {
  const bySlug = new Map(posts.map((p) => [p.slug, p]));
  return {
    posts,
    index() {
      const body = `<h1>Learn the AI stack, then prove it on your CV.</h1><p class="lede">Short, practical guides on MCP, agents and the engineering behind AI products — written for students and engineers moving into AI roles.</p>
<ul class="list">${posts.map((p) => `<li><a class="card" href="/blog/${p.slug}"><h2>${esc(p.title)}</h2><p>${esc(p.description)}</p><div class="meta">${p.level ? `<span class="level">${esc(p.level)}</span>` : ''}${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}<span>${p.minutes} min read</span><span>${fmtDate(p.date)}</span></div></a></li>`).join('')}</ul>`;
      return layout({ title: 'Learn — MCP, agents and AI engineering | Roledone', description: 'Practical guides on MCP, AI agents, RAG and prompt engineering for students and engineers moving into AI roles.', body, canonical: `${siteUrl}/blog` });
    },
    post(slug) {
      const p = bySlug.get(slug);
      if (!p) return null;
      const body = `<article><div class="meta">${p.level ? `<span class="level">${esc(p.level)}</span>` : ''}${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}<span>${p.minutes} min read</span><span>${fmtDate(p.date)}</span></div>
<h1>${esc(p.title)}</h1><p class="lede">${esc(p.description)}</p>${p.html}</article>
<section class="next"><h2>Learned it? Now show it.</h2><p>Paste a real job advert into Roledone. It lists what the role asks for, quotes the lines in your CV that prove it, and shows exactly where the evidence is missing — free.</p><a href="/#match">Scan my CV against a role ↗</a></section>`;
      const jsonLd = { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: p.description, datePublished: p.date, author: { '@type': 'Organization', name: 'Roledone' }, mainEntityOfPage: `${siteUrl}/blog/${p.slug}` };
      return layout({ title: `${p.title} | Roledone Learn`, description: p.description, body, canonical: `${siteUrl}/blog/${p.slug}`, jsonLd });
    },
    sitemap() {
      const urls = [`${siteUrl}/`, `${siteUrl}/blog`, ...posts.map((p) => `${siteUrl}/blog/${p.slug}`)];
      return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
    },
    robots() { return `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`; },
  };
}
