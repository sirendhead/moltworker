#!/usr/bin/env node
// Read a webpage via Jina AI Reader (free, no API key needed)
// Usage: node read_page.js https://example.com
const url = process.argv[2];
if (!url) {
  console.error('Usage: node read_page.js https://example.com');
  process.exit(1);
}

fetch(`https://r.jina.ai/${url}`, {
  headers: {
    'Accept': 'text/plain',
    'X-Return-Format': 'markdown'
  }
})
  .then(r => r.text())
  .then(content => {
    const lines = content.split('\n');
    const title = lines.find(l => l.startsWith('# ')) || '';
    const headings = lines.filter(l => l.match(/^#{1,3} /));
    const wordCount = content.split(/\s+/).length;

    console.log(JSON.stringify({
      url,
      title: title.replace('# ', ''),
      headings,
      wordCount,
      content: content.slice(0, 3000)
    }, null, 2));
  })
  .catch(err => { console.error('Error:', err.message); process.exit(1); });
