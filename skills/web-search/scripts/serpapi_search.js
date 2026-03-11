#!/usr/bin/env node
// Search Google via ScraperAPI with autoparse
// Usage: node serpapi_search.js "search query"
const query = process.argv[2];
if (!query) {
  console.error('Usage: node serpapi_search.js "search query"');
  process.exit(1);
}
const apiKey = process.env.SCRAPER_API_KEY || process.env.SERPAPI_KEY;
if (!apiKey) { console.error('SCRAPER_API_KEY not set'); process.exit(1); }

const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=vi&gl=vn`;
const url = `https://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(googleUrl)}&autoparse=true`;

fetch(url)
  .then(r => r.json())
  .then(data => {
    const results = (data.organic_results || []).map((r, i) => ({
      position: r.position || i + 1,
      title: r.title,
      url: r.link || r.url,
      snippet: r.snippet || r.description
    }));
    console.log(JSON.stringify(results, null, 2));
  })
  .catch(err => { console.error('Error:', err.message); process.exit(1); });
