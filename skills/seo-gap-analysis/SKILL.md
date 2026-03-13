---
name: seo-gap-analysis
description: Analyze SEO content and keyword gaps between a target site and its competitors. Crawls SERPs for multiple keywords, maps which domains rank where, and identifies opportunities. Use when the user asks about competitor analysis, content gaps, keyword gaps, SEO opportunities, or competitive SEO research.
---

# SEO Gap Analysis

Compare a target domain against SERP competitors to find keyword and content gaps.

## Commands

### Competitor Map
Crawl multiple keywords and build a competitor ranking matrix:
```bash
node /root/clawd/skills/seo-gap-analysis/scripts/competitor-map.js "keyword1" "keyword2" "keyword3" --domain=target-domain.com
```

Returns a matrix showing which domains rank for which keywords, with the target domain highlighted.

### Quick Gap Check
Check if a domain ranks for a specific keyword set:
```bash
node /root/clawd/skills/seo-gap-analysis/scripts/gap-check.js --domain=target.com --keywords="kw1,kw2,kw3,kw4,kw5"
```

Returns: ranked (with position) vs. not ranked for each keyword.

## How to Use

### Full Gap Analysis Workflow
1. **Identify seed keywords**: Ask the user for 5-10 primary keywords
2. **Run competitor map**: Maps the competitive landscape
3. **Expand keyword set**: Use PAA and Related Searches from SERP data
4. **Run gap check**: For the expanded set against the user's domain
5. **Prioritize**: Score gaps by volume estimate, difficulty, and relevance
6. **Report**: Present findings in a structured table with action items

### Quick Competitive Check
1. Run `gap-check.js` with the user's domain and target keywords
2. Identify which keywords they're missing
3. Check the top-ranking pages for those keywords to understand why

## Output Format

### Competitor Map
```
Keyword          | domain1.com | domain2.com | target.com | domain3.com
best coffee      |     #1      |     #3      |    ---     |     #7
coffee beans     |     #2      |     #1      |     #5     |     #4
buy coffee       |     ---     |     #2      |    ---     |     #1
```
`---` = not in top 10 = GAP for that domain

### Gap Check
```
GAPS (not ranking):        buy coffee, coffee grinder, espresso tips
RANKING (positions):       coffee beans (#5), best coffee (#12)
OPPORTUNITY SCORE:         3 gaps out of 5 keywords (60% gap rate)
```
