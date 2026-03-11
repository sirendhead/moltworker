#!/usr/bin/env node
// Compare keyword rankings between your site and a competitor via ScraperAPI
// Usage: MY_DOMAIN=my.com COMPETITOR_DOMAIN=comp.com node keyword_battle.js "kw1" "kw2"
const keywords = process.argv.slice(2);
if (keywords.length === 0) {
  console.error('Usage: MY_DOMAIN=x COMPETITOR_DOMAIN=y node keyword_battle.js "kw1" "kw2"');
  process.exit(1);
}
const myDomain = process.env.MY_DOMAIN;
const competitorDomain = process.env.COMPETITOR_DOMAIN;
const apiKey = process.env.SCRAPER_API_KEY || process.env.SERPAPI_KEY;
if (!apiKey) { console.error('SCRAPER_API_KEY not set'); process.exit(1); }
if (!myDomain || !competitorDomain) { console.error('MY_DOMAIN and COMPETITOR_DOMAIN required'); process.exit(1); }

async function checkKeyword(kw) {
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(kw)}&num=10&hl=vi&gl=vn`;
  const url = `https://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(googleUrl)}&autoparse=true`;
  const data = await fetch(url).then(r => r.json());
  const organic = data.organic_results || [];

  const findPos = (domain) => {
    const idx = organic.findIndex(r => (r.link || r.url || '').includes(domain));
    return idx >= 0 ? (organic[idx].position || idx + 1) : '-';
  };

  return { keyword: kw, my_position: findPos(myDomain), competitor_position: findPos(competitorDomain) };
}

(async () => {
  // Sequential to respect rate limits
  const results = [];
  for (const kw of keywords) {
    results.push(await checkKeyword(kw));
  }

  console.log('\n🔑 Keyword Battle:');
  console.log(`${'Keyword'.padEnd(40)} | Mine | Competitor`);
  console.log('-'.repeat(60));
  results.forEach(r => {
    const myWin = r.my_position !== '-' && (r.competitor_position === '-' || r.my_position < r.competitor_position);
    const icon = myWin ? '✅' : '⚠️';
    console.log(`${icon} ${r.keyword.padEnd(38)} | ${String(r.my_position).padEnd(4)} | ${r.competitor_position}`);
  });
  console.log(JSON.stringify(results, null, 2));
})().catch(err => { console.error('Error:', err.message); process.exit(1); });
