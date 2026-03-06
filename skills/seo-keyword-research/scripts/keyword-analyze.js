#!/usr/bin/env node
/**
 * SEO Keyword Analyzer - SERP crawl + intent classification + difficulty estimation
 *
 * Usage:
 *   node keyword-analyze.js "keyword"
 *   node keyword-analyze.js "keyword" --lang=vi --country=vn
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
  console.error('Usage: node keyword-analyze.js "keyword" [--lang=en] [--country=us]');
  process.exit(1);
}

const lang = flags.lang || 'en';
const country = flags.country || 'us';

// High-authority domains that indicate competitive keywords
const HIGH_AUTHORITY_DOMAINS = new Set([
  'wikipedia.org', 'amazon.com', 'youtube.com', 'reddit.com',
  'facebook.com', 'twitter.com', 'linkedin.com', 'instagram.com',
  'forbes.com', 'nytimes.com', 'bbc.com', 'cnn.com',
  'healthline.com', 'webmd.com', 'mayoclinic.org',
  'shopify.com', 'etsy.com', 'ebay.com', 'walmart.com',
  'yelp.com', 'tripadvisor.com', 'imdb.com',
  'gov', 'edu', // TLDs
]);

function classifyIntent(keyword, results, features) {
  const kw = keyword.toLowerCase();

  // Navigational signals
  const brandPatterns = /^(facebook|google|youtube|amazon|twitter|instagram|netflix|spotify)\b/;
  if (brandPatterns.test(kw) || kw.includes(' login') || kw.includes(' sign in')) {
    return { intent: 'navigational', confidence: 0.9 };
  }

  // Transactional signals
  const transactionalPatterns = /\b(buy|purchase|order|price|cheap|deal|discount|coupon|shop|store|for sale|shipping)\b/;
  if (transactionalPatterns.test(kw) || features.shoppingAds) {
    return { intent: 'transactional', confidence: features.shoppingAds ? 0.85 : 0.75 };
  }

  // Commercial investigation
  const commercialPatterns = /\b(best|top|review|vs|versus|compare|comparison|alternative|recommend)\b/;
  if (commercialPatterns.test(kw)) {
    return { intent: 'commercial', confidence: 0.8 };
  }

  // Informational signals
  const infoPatterns = /\b(how|what|why|when|where|who|which|guide|tutorial|learn|definition|meaning|example)\b/;
  if (infoPatterns.test(kw) || features.featuredSnippet || features.knowledgePanel) {
    return { intent: 'informational', confidence: 0.8 };
  }

  // Local intent
  if (features.localPack || /\b(near me|nearby|in \w+|local)\b/.test(kw)) {
    return { intent: 'local', confidence: 0.85 };
  }

  // Default: classify based on SERP composition
  const hasCommerce = results.some(r =>
    r.domain?.includes('amazon') || r.domain?.includes('ebay') || r.domain?.includes('shopify')
  );
  if (hasCommerce) {
    return { intent: 'commercial', confidence: 0.6 };
  }

  return { intent: 'informational', confidence: 0.5 };
}

function estimateDifficulty(results) {
  if (!results || results.length === 0) return { score: 0, level: 'unknown' };

  let authorityScore = 0;
  for (const r of results.slice(0, 10)) {
    const domain = r.domain || '';
    // Check exact domain or TLD
    if (HIGH_AUTHORITY_DOMAINS.has(domain)) {
      authorityScore += 10;
    } else if (domain.endsWith('.gov') || domain.endsWith('.edu')) {
      authorityScore += 10;
    } else if (HIGH_AUTHORITY_DOMAINS.has(domain.split('.').slice(-2).join('.'))) {
      authorityScore += 8;
    } else {
      // Rough heuristic: shorter domains tend to be more established
      authorityScore += domain.length < 15 ? 5 : 3;
    }
  }

  // Normalize to 0-100
  const score = Math.min(100, Math.round(authorityScore));

  let level;
  if (score >= 70) level = 'hard';
  else if (score >= 40) level = 'medium';
  else level = 'easy';

  return { score, level };
}

function classifyContentTypes(results) {
  const types = {};
  for (const r of results) {
    const url = (r.url || '').toLowerCase();
    const title = (r.title || '').toLowerCase();
    const domain = r.domain || '';

    let type = 'article';
    if (domain.includes('youtube') || url.includes('/watch')) type = 'video';
    else if (url.includes('/product') || url.includes('/dp/') || url.includes('/item/')) type = 'product';
    else if (title.match(/\b(wiki|definition|meaning)\b/)) type = 'reference';
    else if (title.match(/\b(forum|discussion|thread|question)\b/) || domain.includes('reddit') || domain.includes('quora')) type = 'forum';
    else if (title.match(/\b(how to|guide|tutorial|step)\b/)) type = 'guide';
    else if (title.match(/\b(best|top \d|review|vs)\b/)) type = 'listicle';
    else if (title.match(/\b(news|update|announce)\b/)) type = 'news';

    types[type] = (types[type] || 0) + 1;
  }
  return types;
}

function generateLongTailSuggestions(keyword, paa, related) {
  const suggestions = [];

  // From PAA questions (already long-tail by nature)
  for (const q of paa) {
    suggestions.push({ source: 'paa', keyword: q });
  }

  // From related searches
  for (const r of related) {
    suggestions.push({ source: 'related', keyword: r });
  }

  // Generate modifier-based suggestions
  const modifiers = {
    informational: ['how to', 'what is', 'why', 'guide', 'tutorial', 'examples'],
    commercial: ['best', 'top', 'review', 'vs', 'alternative to'],
    transactional: ['buy', 'cheap', 'price', 'deals', 'discount'],
    local: ['near me', 'in my area'],
  };

  // Add a few modifier suggestions that aren't already covered
  const existingLower = new Set([...paa, ...related].map(s => s.toLowerCase()));
  for (const mod of modifiers.informational.slice(0, 3)) {
    const suggestion = `${mod} ${keyword}`;
    if (!existingLower.has(suggestion.toLowerCase())) {
      suggestions.push({ source: 'generated', keyword: suggestion });
    }
  }
  for (const mod of modifiers.commercial.slice(0, 2)) {
    const suggestion = `${mod} ${keyword}`;
    if (!existingLower.has(suggestion.toLowerCase())) {
      suggestions.push({ source: 'generated', keyword: suggestion });
    }
  }

  return suggestions;
}

// Reuse SERP parsing from serp-crawl.js
const PARSE_SERP_SCRIPT = `
(() => {
  const results = [];
  const organicSelectors = [
    '#search .g:not(.g .g)',
    '#rso .g:not(.g .g)',
    'div[data-sokoban-container] .g',
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
        url,
        snippet: snippetEl ? snippetEl.innerText.trim() : '',
        domain,
      });
    }
  });
  const paaQuestions = [];
  document.querySelectorAll('[data-sgrd] [role="heading"], .related-question-pair [role="heading"], div[jsname] .dnXCYb').forEach(el => {
    const text = el.innerText.trim();
    if (text && text.length > 5) paaQuestions.push(text);
  });
  if (paaQuestions.length === 0) {
    document.querySelectorAll('[data-lk], .Wt5Tfe').forEach(el => {
      const text = el.innerText.trim();
      if (text && text.length > 5 && text.endsWith('?')) paaQuestions.push(text);
    });
  }
  const relatedSearches = [];
  document.querySelectorAll('#botstuff .k8XOCe a, .y6Uyqe a .mfMhoc, #brs a, .AJLUJb a').forEach(el => {
    const text = el.innerText.trim();
    if (text && text.length > 2) relatedSearches.push(text);
  });
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

function buildGoogleUrl(keyword) {
  const params = new URLSearchParams({ q: keyword, hl: lang, gl: country, num: '10' });
  return `https://www.google.com/search?${params.toString()}`;
}

async function analyzeKeyword(client, keyword) {
  const url = buildGoogleUrl(keyword);
  console.error(`Analyzing: ${keyword}`);

  await client.navigate(url, 4000);

  // Handle consent
  const consentCheck = await client.evaluate(
    `document.querySelector('form[action*="consent"]') ? 'consent' : 'ok'`
  );
  if (consentCheck.result?.value === 'consent') {
    await client.evaluate(
      `document.querySelector('button[id*="agree"], form[action*="consent"] button')?.click()`
    );
    await new Promise(r => setTimeout(r, 3000));
  }

  const parseResult = await client.evaluate(PARSE_SERP_SCRIPT);
  let parsed;
  try {
    parsed = JSON.parse(parseResult.result?.value || '{}');
  } catch (e) {
    parsed = { results: [], peopleAlsoAsk: [], relatedSearches: [], features: {} };
  }

  const intentAnalysis = classifyIntent(keyword, parsed.results || [], parsed.features || {});
  const difficulty = estimateDifficulty(parsed.results || []);
  const contentTypes = classifyContentTypes(parsed.results || []);
  const longTailSuggestions = generateLongTailSuggestions(
    keyword,
    parsed.peopleAlsoAsk || [],
    parsed.relatedSearches || []
  );

  return {
    keyword,
    url,
    timestamp: new Date().toISOString(),
    lang,
    country,
    ...parsed,
    analysis: {
      searchIntent: intentAnalysis,
      difficulty,
      contentTypes,
      longTailSuggestions,
      topDomains: [...new Set((parsed.results || []).map(r => r.domain).filter(Boolean))],
    },
  };
}

async function main() {
  const client = await createClient();

  try {
    await client.setViewport(1280, 900, 1, false);

    const results = [];
    for (const keyword of keywords) {
      const result = await analyzeKeyword(client, keyword);
      results.push(result);
      if (keywords.length > 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

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
