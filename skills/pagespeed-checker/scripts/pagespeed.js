#!/usr/bin/env node
// Check PageSpeed and Core Web Vitals for a URL
// Usage: node pagespeed.js https://example.com [mobile|desktop]
const url = process.argv[2];
const strategy = process.argv[3] || 'mobile';
if (!url) {
  console.error('Usage: node pagespeed.js https://example.com [mobile|desktop]');
  process.exit(1);
}

const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}`;

fetch(apiUrl)
  .then(r => r.json())
  .then(data => {
    const cats = data.lighthouseResult?.categories || {};
    const audits = data.lighthouseResult?.audits || {};
    const cwv = data.loadingExperience?.metrics || {};

    console.log(JSON.stringify({
      url,
      strategy,
      scores: {
        performance: Math.round((cats.performance?.score || 0) * 100),
        seo: Math.round((cats.seo?.score || 0) * 100),
        accessibility: Math.round((cats.accessibility?.score || 0) * 100),
        best_practices: Math.round((cats['best-practices']?.score || 0) * 100)
      },
      core_web_vitals: {
        lcp: cwv.LARGEST_CONTENTFUL_PAINT_MS?.percentile ? cwv.LARGEST_CONTENTFUL_PAINT_MS.percentile + 'ms' : 'N/A',
        fid: cwv.FIRST_INPUT_DELAY_MS?.percentile ? cwv.FIRST_INPUT_DELAY_MS.percentile + 'ms' : 'N/A',
        cls: cwv.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile || 'N/A',
        fcp: cwv.FIRST_CONTENTFUL_PAINT_MS?.percentile ? cwv.FIRST_CONTENTFUL_PAINT_MS.percentile + 'ms' : 'N/A'
      },
      key_metrics: {
        time_to_interactive: audits['interactive']?.displayValue || 'N/A',
        total_blocking_time: audits['total-blocking-time']?.displayValue || 'N/A',
        speed_index: audits['speed-index']?.displayValue || 'N/A'
      }
    }, null, 2));
  })
  .catch(err => { console.error('Error:', err.message); process.exit(1); });
