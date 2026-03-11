#!/usr/bin/env node
// Audit SEO signals of a page via Jina AI Reader
// Usage: node seo_audit_page.js https://competitor.com/page
const url = process.argv[2];
if (!url) {
  console.error('Usage: node seo_audit_page.js https://example.com/page');
  process.exit(1);
}

async function auditPage(url) {
  const content = await fetch(`https://r.jina.ai/${url}`, {
    headers: { 'Accept': 'text/plain', 'X-Return-Format': 'markdown' }
  }).then(r => r.text());

  const h1 = content.match(/^# .+/m)?.[0]?.replace('# ', '') || '';
  const h2s = [...content.matchAll(/^## (.+)/gm)].map(m => m[1]);
  const h3s = [...content.matchAll(/^### (.+)/gm)].map(m => m[1]);
  const wordCount = content.replace(/[#*`\[\]]/g, '').split(/\s+/).filter(Boolean).length;
  const links = [...content.matchAll(/\[.+?\]\((.+?)\)/g)].map(m => m[1]);
  const hostname = new URL(url).hostname;
  const internalLinks = links.filter(l => !l.startsWith('http') || l.includes(hostname));

  return {
    url,
    h1,
    h2_count: h2s.length,
    h2s: h2s.slice(0, 10),
    h3_count: h3s.length,
    word_count: wordCount,
    internal_links: internalLinks.length,
    external_links: links.length - internalLinks.length,
    content_preview: content.slice(0, 500)
  };
}

auditPage(url)
  .then(r => console.log(JSON.stringify(r, null, 2)))
  .catch(err => { console.error('Error:', err.message); process.exit(1); });
