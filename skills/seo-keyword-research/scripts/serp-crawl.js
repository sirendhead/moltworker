#!/usr/bin/env node
/**
 * SEO SERP Crawler - Crawls Google Search results via CDP
 *
 * Usage:
 *   node serp-crawl.js "keyword"
 *   node serp-crawl.js "keyword1" "keyword2" "keyword3"
 *   node serp-crawl.js "keyword" --lang=vi --country=vn
 *
 * Requires: CDP_SECRET, WORKER_URL env vars
 */

const { createClient } = require('../../cloudflare-browser/scripts/cdp-client');

// Parse args
const args = process.argv.slice(2);
const flags = {};
const keywords = [];

for (const arg of args) {
  if (arg.startsWith('--')) {
    const [key, val] = arg.slice(2).split('=');
    flags[key] = val || true;
  } else {
    keywords.push(arg);
  }
}

if (keywords.length === 0) {
  console.error('Usage: node serp-crawl.js "keyword" [--lang=en] [--country=us]');
  process.exit(1);
}

const lang = flags.lang || 'en';
const country = flags.country || 'us';

function buildGoogleUrl(keyword) {
  const params = new URLSearchParams({
    q: keyword,
    hl: lang,
    gl: country,
    num: '10',
  });
  return `https://www.google.com/search?${params.toString()}`;
}

/**
 * Parse SERP HTML to extract structured data.
 * This runs inside the browser via Runtime.evaluate.
 */
const PARSE_SERP_SCRIPT = `
(() => {
  const results = [];

  // Organic results - multiple selector strategies
  const organicSelectors = [
    '#search .g:not(.g .g)',           // Standard results
    '#rso .g:not(.g .g)',              // Alternative container
    'div[data-sokoban-container] .g',  // Newer layout
  ];

  let organicEls = [];
  for (const sel of organicSelectors) {
    organicEls = document.querySelectorAll(sel);
    if (organicEls.length > 0) break;
  }

  let position = 0;
  organicEls.forEach(el => {
    const linkEl = el.querySelector('a[href^="http"]');
    const titleEl = el.querySelector('h3');
    const snippetEl = el.querySelector('[data-sncf], .VwiC3b, [style*="-webkit-line-clamp"]');

    if (linkEl && titleEl) {
      position++;
      const url = linkEl.href;
      let domain = '';
      try { domain = new URL(url).hostname.replace('www.', ''); } catch(e) {}

      results.push({
        position,
        title: titleEl.innerText.trim(),
        url: url,
        snippet: snippetEl ? snippetEl.innerText.trim() : '',
        domain: domain,
      });
    }
  });

  // People Also Ask
  const paaQuestions = [];
  const paaEls = document.querySelectorAll('[data-sgrd] [role="heading"], .related-question-pair [role="heading"], div[jsname] .dnXCYb');
  paaEls.forEach(el => {
    const text = el.innerText.trim();
    if (text && text.length > 5) paaQuestions.push(text);
  });
  // Fallback: look for expandable PAA sections
  if (paaQuestions.length === 0) {
    document.querySelectorAll('[data-lk], .Wt5Tfe').forEach(el => {
      const text = el.innerText.trim();
      if (text && text.length > 5 && text.endsWith('?')) paaQuestions.push(text);
    });
  }

  // Related Searches
  const relatedSearches = [];
  const relatedEls = document.querySelectorAll('#botstuff .k8XOCe a, .y6Uyqe a .mfMhoc, #brs a, .AJLUJb a');
  relatedEls.forEach(el => {
    const text = el.innerText.trim();
    if (text && text.length > 2) relatedSearches.push(text);
  });

  // SERP Features detection
  const features = {
    featuredSnippet: !!document.querySelector('.xpdopen, .ifM9O, [data-attrid="wa:/description"]'),
    knowledgePanel: !!document.querySelector('.kp-wholepage, .knowledge-panel, #rhs .kp-blk'),
    localPack: !!document.querySelector('.VkpGBb, [data-local-attribute]'),
    videoCarousel: !!document.querySelector('.RzdJxc, [data-ved] g-scrolling-carousel video-voyager'),
    imageCarousel: !!document.querySelector('g-scrolling-carousel g-inner-card, .islrc'),
    shoppingAds: !!document.querySelector('.commercial-unit-desktop-top, .pla-unit, .cu-container'),
    sitelinks: !!document.querySelector('.usJj9c, table.jmjoTe'),
    newsBox: !!document.querySelector('[data-news-doc-id], g-section-with-header [data-hveid]'),
  };

  return JSON.stringify({
    resultCount: results.length,
    results: results.slice(0, 10),
    peopleAlsoAsk: [...new Set(paaQuestions)].slice(0, 8),
    relatedSearches: [...new Set(relatedSearches)].slice(0, 8),
    features,
  });
})()
`;

async function crawlKeyword(client, keyword) {
  const url = buildGoogleUrl(keyword);
  console.error(`Crawling: ${keyword} → ${url}`);

  // Navigate to Google SERP
  await client.navigate(url, 4000);

  // Handle consent page (EU/some regions)
  const consentCheck = await client.evaluate(
    `document.querySelector('form[action*="consent"]') ? 'consent' : 'ok'`
  );
  if (consentCheck.result?.value === 'consent') {
    console.error('Consent page detected, accepting...');
    await client.evaluate(
      `document.querySelector('button[id*="agree"], form[action*="consent"] button')?.click()`
    );
    await new Promise(r => setTimeout(r, 3000));
  }

  // Parse SERP
  const parseResult = await client.evaluate(PARSE_SERP_SCRIPT);

  let parsed;
  try {
    parsed = JSON.parse(parseResult.result?.value || '{}');
  } catch (e) {
    console.error('Failed to parse SERP results, trying text extraction fallback...');
    const text = await client.getText();
    parsed = { results: [], peopleAlsoAsk: [], relatedSearches: [], features: {}, rawText: text?.substring(0, 2000) };
  }

  return {
    keyword,
    url,
    timestamp: new Date().toISOString(),
    lang,
    country,
    ...parsed,
  };
}

async function main() {
  const client = await createClient();

  try {
    // Set desktop viewport
    await client.setViewport(1280, 900, 1, false);

    const results = [];
    for (const keyword of keywords) {
      const result = await crawlKeyword(client, keyword);
      results.push(result);

      // Brief pause between keywords to avoid rate limiting
      if (keywords.length > 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Output JSON to stdout
    const output = keywords.length === 1 ? results[0] : results;
    console.log(JSON.stringify(output, null, 2));

  } finally {
    client.close();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
