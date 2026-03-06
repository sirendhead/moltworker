# SEO Keyword Research Agent - Cách 2 (Agent riêng)

## Kiến trúc
```
Telegram → SEO Agent (CF Worker) → crawl SERPs (fetch/scrape)
                                  → gọi OpenClaw WS API (browser nặng, bypass anti-bot)
                                  → lưu D1 database (keyword history, rankings)
                                  → trả kết quả Telegram
```

## Tech Stack
- Cloudflare Worker + Hono
- D1 database (keyword data, ranking history, competitor tracking)
- OpenClaw WS API (`wss://claw.colorverse.dev/ws?token=...`) cho browser automation
- Telegram Bot API trực tiếp (grammy hoặc raw API)

## Features
- Crawl Google SERPs cho keyword → top 10 results (title, URL, meta)
- People Also Ask extraction
- Related Searches extraction
- Long-tail keyword suggestions
- Search intent classification (informational, transactional, navigational)
- Keyword difficulty estimation
- Track rankings theo thời gian (daily/weekly snapshots)
- Competitor domain analysis
- Content gap analysis
- Bulk keyword research (csv import)
- Scheduled rank tracking (cron)

## Database Schema
- keywords (id, keyword, language, country, created_at)
- serp_snapshots (id, keyword_id, rank, url, title, snippet, timestamp)
- paa_questions (id, keyword_id, question, timestamp)
- related_searches (id, keyword_id, term, timestamp)
- competitors (id, domain, keywords tracked)
- rank_history (id, keyword_id, domain, position, timestamp)

## OpenClaw Integration
- WS connect → send message "crawl google.com/search?q=..." → get browser-rendered HTML
- Bypass Google anti-bot (headless Chrome via OpenClaw's Playwright)
- Parse HTML → extract SERP features
- Fallback: direct fetch for simple queries

## Telegram UX
- /research <keyword> → full SERP analysis
- /suggest <seed> → long-tail suggestions
- /track <keyword> <domain> → add to rank tracker
- /report → weekly ranking report
- /competitors <domain> → competitor keyword analysis
