#!/usr/bin/env node
// Check rank of a domain for a keyword via ScraperAPI Google Search
// Usage: node check_rank.js "[keyword]" domain.com
const [keyword, domain] = process.argv.slice(2);
if (!keyword || !domain) {
  console.error('Usage: node check_rank.js "[keyword]" domain.com');
  process.exit(1);
}
const apiKey = process.env.SCRAPER_API_KEY || process.env.SERPAPI_KEY;
if (!apiKey) { console.error('SCRAPER_API_KEY not set'); process.exit(1); }

const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&num=20&hl=vi&gl=vn`;
const url = `https://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(googleUrl)}&autoparse=true`;

fetch(url)
  .then(r => r.json())
  .then(data => {
    const organic = data.organic_results || [];
    const domainResults = organic.filter(r => (r.link || r.url || '').includes(domain));
    const paa = (data.people_also_ask || data.related_questions || []).map(q => q.question || q.title || q);

    console.log(JSON.stringify({
      keyword,
      domain,
      rank: domainResults.length > 0 ? {
        position: domainResults[0].position || organic.indexOf(domainResults[0]) + 1,
        title: domainResults[0].title,
        url: domainResults[0].link || domainResults[0].url
      } : { position: 'not in top 20' },
      top_5: organic.slice(0, 5).map((r, i) => ({
        position: r.position || i + 1,
        domain: (() => { try { return new URL(r.link || r.url || '').hostname; } catch { return r.link || r.url || ''; } })(),
        title: r.title
      })),
      people_also_ask: paa.slice(0, 5),
      total_results: organic.length
    }, null, 2));
  })
  .catch(err => { console.error('Error:', err.message); process.exit(1); });
