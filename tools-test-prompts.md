Now let me check what UI kinds the frontend renders.

Good. Here are the 5 tool UI kinds and exactly what each renders:

- **`search`** — `SearchCard`: shows engines used + ranked result links with snippets
- **`map`** — `MapCard`: interactive MapLibre map with pins (used by both `hd_maps` and `hd_plot_map`)
- **`crawl`** — `CrawlCard`: shows URL, source engine, character count
- **`archive`** — `ArchiveCard`: shows URL, capture date/year
- **MCP tools** — `McpCard`: generic fallback for any MCP server tool

Here are 15 prompts with the exact tool card you should see:

| # | Prompt | Tool(s) fired | Expected UI card(s) |
|---|--------|---------------|---------------------|
| 1 | `What are the biggest cybersecurity breaches of 2026?` | `hd_search` | **SearchCard** — list of engines (duckduckgo, searxng, etc.) + ranked results with titles, URLs, snippets |
| 2 | `Find recent news about ransomware attacks on hospitals` | `hd_search` | **SearchCard** — news-oriented results with snippets about hospital ransomware |
| 3 | `Search for NER models for cybersecurity text extraction` | `hd_search` | **SearchCard** — academic/technical results about CyNER, spaCy, etc. |
| 4 | `Read this page and summarize it: https://owasp.org/www-project-top-ten/` | `hd_crawl` | **CrawlCard** — shows `owasp.org`, source engine (crawl4ai/browserless), char count like `5.2k chars` |
| 5 | `What does https://github.com/anthropics/claude-code say?` | `hd_crawl` | **CrawlCard** — shows `github.com`, char count |
| 6 | `Crawl https://hackerdogs.ai and tell me what the product does` | `hd_crawl` | **CrawlCard** — shows `hackerdogs.ai`, source, char count |
| 7 | `Find coffee shops near downtown San Francisco` | `hd_maps` | **MapCard** — interactive map with pins for coffee shops, each with name + address |
| 8 | `Where are the best coworking spaces in Austin, TX?` | `hd_maps` | **MapCard** — pins for coworking spaces with addresses |
| 9 | `Show me data centers near Ashburn, Virginia` | `hd_maps` | **MapCard** — pins for data center facilities |
| 10 | `Plot the Five Eyes countries on a map` | `hd_plot_map` | **MapCard** — 5 pins (US, UK, Canada, Australia, New Zealand) with country names |
| 11 | `Show me a map of countries the Danube river flows through` | `hd_plot_map` | **MapCard** — ~10 pins (Germany, Austria, Slovakia, Hungary, Croatia, Serbia, Romania, Bulgaria, Moldova, Ukraine) |
| 12 | `Map the headquarters of the top 5 tech companies` | `hd_plot_map` | **MapCard** — pins for Apple (Cupertino), Google (Mountain View), Microsoft (Redmond), Amazon (Seattle), Meta (Menlo Park) |
| 13 | `Show me what yahoo.com looked like in 2005` | `hd_archive` | **ArchiveCard** — shows `yahoo.com`, capture year badge (e.g. `2005`), archived page content summary |
| 14 | `Find an archived version of https://www.theranos.com` | `hd_archive` | **ArchiveCard** — shows `theranos.com`, capture date badge |
| 15 | `Research the top 3 SIEM platforms, read their homepages, and show their headquarters on a map` | `hd_search` + `hd_crawl` (x3) + `hd_plot_map` | **SearchCard** (initial search) + **3 CrawlCards** (one per vendor homepage) + **MapCard** (HQ pins) — tests multi-tool chaining |




| # | Prompt | Tool | UI Card | Expected Output |
|---|--------|------|---------|-----------------|
| 1 | What are the latest developments in quantum computing? | hd_search (web) | SearchCard | Grid of 6-8 result links with favicons, titles, snippets, engine badges |
| 2 | Find coffee shops near San Ramon, CA | hd_maps | MapCard | Interactive MapLibre map with pins + scrollable place list with addresses |
| 3 | Show me the countries the Danube river flows through on a map | hd_plot_map | MapCard | Map with pins on Germany, Austria, Slovakia, Hungary, Croatia, Serbia, Romania, Bulgaria, Moldova, Ukraine |
| 4 | Read the full article at https://en.wikipedia.org/wiki/Hackathon | hd_crawl | CrawlCard | Favicon + "en.wikipedia.org" + title + "X.Xk chars extracted" |
| 5 | Show me an archived version of google.com | hd_archive | ArchiveCard | Title + "google.com" + "captured [date]" from Common Crawl |
| 6 | Search for images of the northern lights | hd_search (images) | ImageGalleryCard | 2-3 column responsive grid of aurora borealis thumbnails with captions |
| 7 | Find videos about how black holes form | hd_search (videos) | VideoCard | YouTube embed iframe (or HTML5 video) with title + duration |
| 8 | What's the latest news about SpaceX Starship? | hd_search (news) | LinkPreviewCard | OG-style cards: thumbnail + title + description + favicon + host for each article |
| 9 | Find scholarly papers on CRISPR gene editing in cancer treatment | hd_search (scholar) | CitationCard | Numbered list of papers with titles, snippets, dates, source URLs, favicons |
| 10 | Compare the GDP of USA, China, Japan, Germany, and India in a bar chart | hd_chart (bar) | ChartCard | SVG bar chart with 5 vertical bars, y-axis values, country labels on x-axis |
| 11 | Show a line chart of global average temperature from 2015 to 2024 | hd_chart (line) | ChartCard | SVG polyline connecting 10 year data points, y-axis temp values |
| 12 | Show a pie chart of global smartphone market share: Apple, Samsung, Xiaomi, others | hd_chart (pie) | ChartCard | SVG circle with 4 colored segments + legend with colored dots and labels |
| 13 | Show an area chart of Netflix subscriber growth from 2018 to 2024 | hd_chart (area) | ChartCard | SVG filled polyline with semi-transparent fill beneath the line |
| 14 | What's the weather in Tokyo right now? | hd_weather | WeatherCard | Large temp (°C) + condition + humidity % + wind speed + 5-day forecast row |
| 15 | Show me a Python quicksort implementation as a code block | hd_render (code_block) | CodeBlockCard | Dark-bordered code box with "python" header, regex-highlighted keywords/strings/numbers |
| 16 | Show a diff of changing a JavaScript function from var to const | hd_render (code_diff) | CodeDiffCard | Unified diff: red `-var` lines, green `+const` lines, @@ hunk header, filename header |
| 17 | Create a table comparing the top 5 programming languages by popularity, typing, and main use case | hd_render (data_table) | DataTableCard | Sortable table with 3 columns, 5 zebra-striped rows, clickable column headers with ▲/▼ |
| 18 | Show me key stats for Tesla: stock price, market cap, revenue, and employees | hd_render (stats) | StatsCard | 2x2 grid of metric cards each with label, large value, optional unit and +/-% change |
| 19 | Show what the output of running "git log --oneline -5" looks like in a terminal | hd_render (terminal) | TerminalCard | Dark bg, green `$` prompt + command, monospace output lines, "exit 0" in green |
| 20 | Create a step-by-step plan for launching a SaaS product | hd_render (plan) | PlanCard | Vertical stepper: colored dots (done=green, active=pulsing blue, pending=gray) + connecting lines + labels |
| 21 | Show a progress tracker for a 5-phase website migration that's 60% done | hd_render (progress) | ProgressCard | Progress bar at 60% + "60%" label + 5 steps with ✓/●/○ status indicators |
| 22 | Draft a tweet announcing a new open source project called HackerDogs | hd_render (social_post, x) | SocialPostCard | Black avatar circle + author/handle + "X" black chip + post text + likes/shares/comments |
| 23 | Draft a LinkedIn post about landing a new engineering manager role | hd_render (social_post, linkedin) | SocialPostCard | Blue #0A66C2 avatar + "LinkedIn" blue chip + post body + engagement counts |
| 24 | Draft an Instagram caption for a photo of a sunset at the Grand Canyon | hd_render (social_post, instagram) | SocialPostCard | Purple-red gradient avatar + "Instagram" gradient chip + caption text |
| 25 | Draft an email to my team about the Q3 planning offsite next Friday | hd_render (message_draft) | MessageDraftCard | "Draft email" header + To: field + bold Subject line + body text |
| 26 | Show an approval card for a $15,000 cloud infrastructure budget request | hd_render (approval) | ApprovalCard | Title + "pending" amber badge + description + key-value item rows (amount, dept, etc.) |
| 27 | Show an order summary for 2 mechanical keyboards at $149 each and a monitor at $599 | hd_render (order_summary) | OrderSummaryCard | Line items with name × qty + price each + divider + bold Total row |
| 28 | Show a list of 4 options for a backend framework: Express, Fastify, Hono, and Koa with pros | hd_render (option_list) | OptionListCard | Question header + 4 radio-style rows with label + description, one optionally selected with blue highlight |
| 29 | Show a Q&A flow for onboarding a new developer: what's your name, preferred IDE, and experience level | hd_render (question_flow) | QuestionFlowCard | 3 Q&A pairs: bold question + answer in brand-50 bg rounded box |
| 30 | Show a carousel of the top 5 tourist attractions in Paris with descriptions | hd_render (item_carousel) | ItemCarouselCard | Horizontal scrollable row of 5 cards (144px wide) each with title + description |
| 31 | Show an audio player for a podcast episode called "The Future of AI" by Tech Talk, 45 minutes | hd_render (audio) | AudioCard | Music note icon + title + "Tech Talk · 45:00" + HTML5 audio controls bar |
| 32 | Show an image card with a caption for the Hubble Deep Field photo | hd_render (image) | ImageCard | Full-width image (object-contain) + caption text below in ink-500 |