#!/usr/bin/env node
// Compare PageSpeed scores of multiple URLs
// Usage: node compare_speeds.js https://my-site.com https://competitor.com
const urls = process.argv.slice(2);
if (urls.length < 2) {
  console.error('Usage: node compare_speeds.js https://site1.com https://site2.com [...]');
  process.exit(1);
}

async function checkSpeed(url) {
  const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile`;
  const data = await fetch(apiUrl).then(r => r.json());
  const cats = data.lighthouseResult?.categories || {};
  return {
    url,
    performance: Math.round((cats.performance?.score || 0) * 100),
    seo: Math.round((cats.seo?.score || 0) * 100),
    accessibility: Math.round((cats.accessibility?.score || 0) * 100)
  };
}

Promise.all(urls.map(checkSpeed))
  .then(results => {
    results.sort((a, b) => b.performance - a.performance);
    console.log('\n📊 Speed Comparison (Mobile):');
    results.forEach((r, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
      console.log(`${medal} ${r.url}: Perf ${r.performance}/100, SEO ${r.seo}/100, A11y ${r.accessibility}/100`);
    });
    console.log(JSON.stringify(results, null, 2));
  })
  .catch(err => { console.error('Error:', err.message); process.exit(1); });
