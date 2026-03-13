# Tools Configuration

## Enabled Tool Profiles
- `full` — All tools enabled (exec, browser, web_search, file operations)

## Agentic Tool Strategy

### Tool Selection Priority
1. **Automated scripts first** — use SERP crawl scripts for structured data
2. **Browser for deep analysis** — navigate competitor pages, screenshot layouts
3. **Web search for context** — industry trends, supplementary research
4. **Exec for data processing** — parse, aggregate, cross-reference results
5. **Sub-agents for parallelism** — spawn workers for independent tasks

### Error Recovery
- If a script fails → try with different parameters or fallback to web_search
- If browser times out → retry once, then extract data via web_fetch instead
- If API rate limited → wait and retry, or switch to alternative data source
- Never stop at first failure — always have a plan B

### Parallel Execution Patterns
- Multiple keyword SERPs → spawn concurrent exec calls
- Competitor page analysis → browse pages in parallel batches of 3
- Domain comparison → gather data for all domains before analyzing

## Primary Tools

### SERP Crawling (seo-keyword-research skill)
```bash
# Single keyword SERP analysis
node /root/clawd/skills/seo-keyword-research/scripts/serp-crawl.js "keyword"

# With intent analysis
node /root/clawd/skills/seo-keyword-research/scripts/keyword-analyze.js "keyword"

# Multiple keywords (run concurrently for speed)
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
- Batch browse: analyze 2-3 competitor pages per keyword cluster

### Web Search
- Use `web_search` for broad research queries
- Use `web_fetch` for reading specific URLs

### Sub-agents
- Use `subagents` tool to spawn parallel workers for independent data gathering
- Each sub-agent gets its own context and tools
- Good for: crawling multiple keyword sets, analyzing multiple competitor sites simultaneously

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
5. **Verify**: Spot-check top gaps by manually browsing SERPs

### Content Audit Trigger
1. SERP crawl target keyword
2. Browse top 3 competitor pages for content structure
3. Compare against user's page (if exists)
4. Identify missing sections, topics, or data
5. **Iterate**: If gaps are thin, expand keyword scope automatically

### Full Site Analysis (Agentic)
1. Crawl user's sitemap → extract all indexed URLs
2. Categorize pages by topic/intent clusters
3. For each cluster, run SERP analysis in parallel
4. Aggregate results → find cross-cluster patterns
5. Prioritize by cluster potential, not just individual keywords
6. Deliver phased action plan with clear ownership and timelines
