#!/usr/bin/env node
// Find top indexed pages of a domain via ScraperAPI
// Usage: node domain_top_pages.js domain.com
const [domain] = process.argv.slice(2);
if (!domain) {
  console.error('Usage: node domain_top_pages.js domain.com');
  process.exit(1);
}
const apiKey = process.env.SCRAPER_API_KEY || process.env.SERPAPI_KEY;
if (!apiKey) { console.error('SCRAPER_API_KEY not set'); process.exit(1); }

const googleUrl = `https://www.google.com/search?q=site:${domain}&num=10`;
const url = `https://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(googleUrl)}&autoparse=true`;

fetch(url)
  .then(r => r.json())
  .then(data => {
    const pages = (data.organic_results || []).map(r => ({
      title: r.title,
      url: r.link || r.url,
      snippet: r.snippet || r.description
    }));

    console.log(JSON.stringify({
      domain,
      indexed_pages_sample: pages,
      total_results: data.search_information?.total_results || pages.length
    }, null, 2));
  })
  .catch(err => { console.error('Error:', err.message); process.exit(1); });
