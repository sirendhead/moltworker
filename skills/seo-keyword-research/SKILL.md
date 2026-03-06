---
name: seo-keyword-research
description: Research SEO keywords by crawling Google SERPs using Cloudflare Browser Rendering. Extracts top 10 results, People Also Ask, Related Searches, and analyzes search intent. Use when the user asks about keyword research, SEO analysis, SERP analysis, or wants to find keywords for a topic.
---

# SEO Keyword Research

Crawl Google Search results and extract structured SEO data using Cloudflare Browser Rendering (CDP).

## Prerequisites

- `CDP_SECRET` and `WORKER_URL` environment variables set
- Browser profile configured (same as cloudflare-browser skill)

## Commands

### Research a keyword
```bash
node /root/clawd/skills/seo-keyword-research/scripts/serp-crawl.js "keyword here"
```

Returns JSON with:
- **Top 10 organic results** (title, URL, snippet, position)
- **People Also Ask** questions
- **Related Searches** at bottom of SERP
- **Search features** detected (featured snippet, knowledge panel, local pack, etc.)

### Analyze keyword with intent classification
```bash
node /root/clawd/skills/seo-keyword-research/scripts/keyword-analyze.js "keyword here"
```

Returns the SERP data plus:
- **Search intent** classification (informational, transactional, navigational, commercial)
- **Keyword difficulty** estimate (based on domain authority signals in top 10)
- **Content type** breakdown (what type of content ranks: blog, product, video, etc.)
- **Long-tail suggestions** derived from PAA + Related Searches

### Bulk research (multiple keywords)
```bash
node /root/clawd/skills/seo-keyword-research/scripts/serp-crawl.js "keyword1" "keyword2" "keyword3"
```

Crawls each keyword sequentially, outputs combined JSON array.

## How to Use

When a user asks to research keywords or do SEO analysis:

1. **Single keyword**: Run `serp-crawl.js` with the keyword, then interpret the results
2. **Keyword + analysis**: Run `keyword-analyze.js` for deeper analysis with intent classification
3. **Multiple keywords**: Pass multiple args to `serp-crawl.js` for comparison
4. **Content planning**: Use PAA questions as content ideas, Related Searches as topic clusters

## Output Format

```json
{
  "keyword": "best coffee beans",
  "timestamp": "2025-01-15T10:30:00Z",
  "results": [
    {
      "position": 1,
      "title": "10 Best Coffee Beans of 2025",
      "url": "https://example.com/best-coffee",
      "snippet": "Our top picks for...",
      "domain": "example.com"
    }
  ],
  "peopleAlsoAsk": [
    "What are the best coffee beans for beginners?",
    "Which coffee beans have the most caffeine?"
  ],
  "relatedSearches": [
    "best coffee beans for espresso",
    "best coffee beans for french press"
  ],
  "features": {
    "featuredSnippet": true,
    "knowledgePanel": false,
    "localPack": false,
    "videoCarousel": false,
    "imageCarousel": true,
    "shoppingAds": true
  }
}
```

## Google Search Parameters

The script uses these defaults:
- Language: `en` (override with `--lang=vi`)
- Country: `us` (override with `--country=vn`)
- Number of results: 10

Example with Vietnamese Google:
```bash
node /root/clawd/skills/seo-keyword-research/scripts/serp-crawl.js "ca phe ngon" --lang=vi --country=vn
```

## Tips

- Google may show different results based on location. Use `--country` to target specific markets.
- For competitive analysis, note which domains appear repeatedly across related keywords.
- PAA questions are excellent for FAQ sections and blog post ideas.
- Related Searches reveal how users think about the topic (great for topic clusters).
- Run the same keyword periodically to track ranking changes.
