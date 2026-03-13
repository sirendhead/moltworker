#!/usr/bin/env node
/**
 * SEO Competitor Map - Crawl multiple keywords and build a competitor ranking matrix
 *
 * Usage:
 *   node competitor-map.js "keyword1" "keyword2" "keyword3" --domain=target.com
 *   node competitor-map.js "keyword1" "keyword2" --domain=target.com --lang=vi --country=vn
 *
 * Requires: CDP_SECRET, WORKER_URL env vars (uses seo-keyword-research SERP crawler)
 */

const { execSync } = require('child_process');
const path = require('path');

const SERP_CRAWL = path.join(__dirname, '../../seo-keyword-research/scripts/serp-crawl.js');

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
  console.error('Usage: node competitor-map.js "kw1" "kw2" ... --domain=target.com [--lang=en] [--country=us]');
  process.exit(1);
}

const targetDomain = (flags.domain || '').toLowerCase();
const langFlag = flags.lang ? ` --lang=${flags.lang}` : '';
const countryFlag = flags.country ? ` --country=${flags.country}` : '';

async function crawlKeyword(keyword) {
  try {
    const cmd = `node "${SERP_CRAWL}" "${keyword}"${langFlag}${countryFlag}`;
    const output = execSync(cmd, { timeout: 60000, encoding: 'utf8' });
    // Find JSON in output (skip any log lines)
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return null;
  } catch (e) {
    console.error(`Failed to crawl "${keyword}": ${e.message}`);
    return null;
  }
}

async function main() {
  console.error(`Analyzing ${keywords.length} keywords...`);

  // Crawl all keywords
  const results = [];
  for (const kw of keywords) {
    console.error(`  Crawling: ${kw}`);
    const data = await crawlKeyword(kw);
    if (data) results.push(data);
  }

  // Build competitor map
  const domainKeywordMap = {}; // domain -> { keyword: position }
  const allDomains = new Set();

  for (const r of results) {
    if (!r.results) continue;
    for (const item of r.results) {
      const domain = (item.domain || new URL(item.url).hostname).toLowerCase();
      allDomains.add(domain);
      if (!domainKeywordMap[domain]) domainKeywordMap[domain] = {};
      domainKeywordMap[domain][r.keyword] = item.position;
    }
  }

  // Sort domains by total rankings (most visible first)
  const sortedDomains = [...allDomains].sort((a, b) => {
    const aCount = Object.keys(domainKeywordMap[a] || {}).length;
    const bCount = Object.keys(domainKeywordMap[b] || {}).length;
    return bCount - aCount;
  });

  // Build output
  const output = {
    targetDomain: targetDomain || '(not specified)',
    keywordsAnalyzed: keywords,
    totalCompetitors: sortedDomains.length,
    competitorMatrix: [],
    gaps: [],
    opportunities: [],
  };

  // Matrix: for each domain, show their positions for each keyword
  for (const domain of sortedDomains.slice(0, 20)) {
    const entry = { domain, rankings: {}, keywordsRanked: 0 };
    for (const kw of keywords) {
      const pos = domainKeywordMap[domain]?.[kw];
      entry.rankings[kw] = pos || null;
      if (pos) entry.keywordsRanked++;
    }
    entry.isTarget = domain === targetDomain;
    output.competitorMatrix.push(entry);
  }

  // Identify gaps for target domain
  if (targetDomain) {
    const targetRankings = domainKeywordMap[targetDomain] || {};
    for (const kw of keywords) {
      if (!targetRankings[kw]) {
        // Find who ranks for this keyword
        const rankers = [];
        for (const domain of sortedDomains) {
          const pos = domainKeywordMap[domain]?.[kw];
          if (pos) rankers.push({ domain, position: pos });
        }
        rankers.sort((a, b) => a.position - b.position);

        output.gaps.push({
          keyword: kw,
          topCompetitors: rankers.slice(0, 5),
        });
      }
    }

    // Opportunities: keywords where target ranks but not in top 3
    for (const kw of keywords) {
      const pos = targetRankings[kw];
      if (pos && pos > 3) {
        output.opportunities.push({
          keyword: kw,
          currentPosition: pos,
          potentialGain: pos - 1,
        });
      }
    }
  }

  // Collect PAA and Related Searches for gap expansion
  const allPAA = [];
  const allRelated = [];
  for (const r of results) {
    if (r.peopleAlsoAsk) allPAA.push(...r.peopleAlsoAsk);
    if (r.relatedSearches) allRelated.push(...r.relatedSearches);
  }
  output.expandedKeywordIdeas = {
    fromPAA: [...new Set(allPAA)],
    fromRelatedSearches: [...new Set(allRelated)],
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
