# Tools Configuration

## Enabled Tool Profiles
- `full` — All tools enabled (exec, browser, web_search, file operations)

## Primary Tools

### SERP Crawling (seo-keyword-research skill)
```bash
# Single keyword SERP analysis
node /root/clawd/skills/seo-keyword-research/scripts/serp-crawl.js "keyword"

# With intent analysis
node /root/clawd/skills/seo-keyword-research/scripts/keyword-analyze.js "keyword"

# Multiple keywords
node /root/clawd/skills/seo-keyword-research/scripts/serp-crawl.js "kw1" "kw2" "kw3"

# Vietnamese market
node /root/clawd/skills/seo-keyword-research/scripts/serp-crawl.js "keyword" --lang=vi --country=vn
```

### SERP Rank Checking (serp-rank-checker skill)
```bash
# Check domain ranking for a keyword
node /root/clawd/skills/serp-rank-checker/scripts/check-rank.js "keyword" "domain.com"
```

### PageSpeed Analysis (pagespeed-checker skill)
```bash
# Check Core Web Vitals
node /root/clawd/skills/pagespeed-checker/scripts/check.js "https://example.com"
```

### Web Browsing
- Use `browser_navigate` + `browser_screenshot` for competitor page analysis
- Use `browser_snapshot` for extracting page content/structure

### Web Search
- Use `web_search` for broad research queries
- Use `webpage_reader` for reading specific URLs

## Workflow Patterns

### Competitor Discovery
1. SERP crawl the user's primary keywords
2. Extract unique domains from top 10 results across all keywords
3. These are the SERP competitors (more relevant than assumed business competitors)

### Gap Analysis Workflow
1. List user's site pages (ask user or crawl sitemap)
2. SERP crawl competitor's ranking keywords
3. Cross-reference: find keywords where competitor ranks but user doesn't
4. Classify gaps by intent and potential impact

### Content Audit Trigger
1. SERP crawl target keyword
2. Browse top 3 competitor pages for content structure
3. Compare against user's page (if exists)
4. Identify missing sections, topics, or data
