#!/usr/bin/env node
/**
 * SEO Gap Check - Quick check if a domain ranks for specific keywords
 *
 * Usage:
 *   node gap-check.js --domain=target.com --keywords="kw1,kw2,kw3"
 *   node gap-check.js --domain=target.com --keywords="kw1,kw2" --lang=vi --country=vn
 *
 * Requires: CDP_SECRET, WORKER_URL env vars
 */

const { execSync } = require('child_process');
const path = require('path');

const SERP_CRAWL = path.join(__dirname, '../../seo-keyword-research/scripts/serp-crawl.js');

// Parse args
const args = process.argv.slice(2);
const flags = {};

for (const arg of args) {
  if (arg.startsWith('--')) {
    const [key, ...valParts] = arg.slice(2).split('=');
    flags[key] = valParts.join('=') || true;
  }
}

const targetDomain = (flags.domain || '').toLowerCase();
const keywords = (flags.keywords || '').split(',').map(k => k.trim()).filter(Boolean);

if (!targetDomain || keywords.length === 0) {
  console.error('Usage: node gap-check.js --domain=target.com --keywords="kw1,kw2,kw3"');
  process.exit(1);
}

const langFlag = flags.lang ? ` --lang=${flags.lang}` : '';
const countryFlag = flags.country ? ` --country=${flags.country}` : '';

function crawlKeyword(keyword) {
  try {
    const cmd = `node "${SERP_CRAWL}" "${keyword}"${langFlag}${countryFlag}`;
    const output = execSync(cmd, { timeout: 60000, encoding: 'utf8' });
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return null;
  } catch (e) {
    console.error(`Failed to crawl "${keyword}": ${e.message}`);
    return null;
  }
}

async function main() {
  console.error(`Checking ${keywords.length} keywords for ${targetDomain}...`);

  const gaps = [];
  const ranking = [];
  const errors = [];

  for (const kw of keywords) {
    console.error(`  Checking: ${kw}`);
    const data = crawlKeyword(kw);

    if (!data || !data.results) {
      errors.push(kw);
      continue;
    }

    // Find target domain in results
    const match = data.results.find(r => {
      const domain = (r.domain || '').toLowerCase();
      return domain === targetDomain || domain.endsWith('.' + targetDomain);
    });

    if (match) {
      ranking.push({
        keyword: kw,
        position: match.position,
        title: match.title,
        url: match.url,
      });
    } else {
      // Gap found — also capture who IS ranking
      const topCompetitor = data.results[0] || null;
      gaps.push({
        keyword: kw,
        topCompetitor: topCompetitor ? {
          domain: topCompetitor.domain,
          position: 1,
          title: topCompetitor.title,
        } : null,
        serpFeatures: data.features || {},
      });
    }
  }

  const gapRate = keywords.length > 0
    ? Math.round((gaps.length / keywords.length) * 100)
    : 0;

  const output = {
    domain: targetDomain,
    summary: {
      totalKeywords: keywords.length,
      ranking: ranking.length,
      gaps: gaps.length,
      errors: errors.length,
      gapRate: `${gapRate}%`,
    },
    ranking: ranking.sort((a, b) => a.position - b.position),
    gaps,
    errors: errors.length > 0 ? errors : undefined,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
