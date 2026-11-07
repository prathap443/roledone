import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, renderMarkdown, loadPosts, createBlog } from '../server/blog.mjs';

test('frontmatter parses keys and tag lists', () => {
  const { meta, body } = parseFrontmatter('---\ntitle: Hi\ntags: a, b\n---\nBody');
  assert.equal(meta.title, 'Hi'); assert.deepEqual(meta.tags, ['a', 'b']); assert.equal(body, 'Body');
});

test('markdown renders blocks and escapes html', () => {
  const html = renderMarkdown('## Head\n\nPara with **bold** and `code` and [a link](/blog).\n\n- one\n- two\n\n1. first\n2. second\n\n```js\nconst x = "<b>";\n```\n\n> quoted\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>');
  assert.match(html, /<h3 id="head">Head<\/h3>/);
  assert.match(html, /<strong>bold<\/strong>/); assert.match(html, /<code>code<\/code>/); assert.match(html, /<a href="\/blog">a link<\/a>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/); assert.match(html, /<ol><li>first<\/li>/);
  assert.match(html, /<pre><code class="lang-js">const x = &quot;&lt;b&gt;&quot;;<\/code><\/pre>/);
  assert.match(html, /<blockquote><p>quoted<\/p><\/blockquote>/);
  assert.match(html, /<table><thead><tr><th>A<\/th><th>B<\/th>/);
  assert.doesNotMatch(html, /<script>/);
});

test('posts load, sort newest first, and render pages', async () => {
  const posts = await loadPosts(new URL('../content/blog', import.meta.url).pathname);
  assert.ok(posts.length >= 5);
  for (let i = 1; i < posts.length; i++) assert.ok(posts[i - 1].date >= posts[i].date);
  for (const p of posts) { assert.ok(p.slug && p.title && p.description, p.slug); assert.ok(p.minutes >= 2, `${p.slug} too short`); }
  const blog = createBlog({ posts, siteUrl: 'https://t.example' });
  assert.match(blog.index(), /<a class="card" href="\/blog\/what-is-mcp">/);
  const page = blog.post('what-is-mcp');
  assert.match(page, /<link rel="canonical" href="https:\/\/t.example\/blog\/what-is-mcp">/); assert.match(page, /BlogPosting/);
  assert.equal(blog.post('nope'), null);
  assert.match(blog.sitemap(), /<loc>https:\/\/t.example\/blog\/how-ai-agents-work<\/loc>/);
});
