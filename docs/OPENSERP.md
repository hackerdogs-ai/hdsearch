# OpenSERP — configuration & how HD-Search leverages it

[OpenSERP](https://github.com/karust/openserp) is a self-hosted SERP scraper that
drives a real headless browser. This build supports **four engines: Google,
Yandex, Bing, and Baidu** (DuckDuckGo/Brave return 404). HD-Search runs it as
`hd-openserp` (host `:7007`, container `:7000`) and treats it as a free,
high-priority web/image source.

**Maximum breadth:** with `HDSEARCH_OPENSERP_MERGE=true` (default) HD-Search fans
out a single openserp query to **all** engines in `HDSEARCH_OPENSERP_ENGINES`
(default `google,yandex,bing,baidu`) concurrently and merges + dedupes the results,
so one call returns the union across Google + Yandex + Bing + Baidu. Set
`HDSEARCH_OPENSERP_MERGE=false` for first-engine-with-results (faster, less broad).

## The core problem: Google captchas datacenter IPs

Google reliably serves a CAPTCHA to requests from server/datacenter IPs (you'll
see `captcha_detected / 429` and `circuit breaker is open` in `docker logs
hd-openserp`). **Yandex and Baidu do not** — they return full results from the
same host. So:

- **Default routing:** HD-Search queries **Yandex first, then Baidu**
  (default `HDSEARCH_OPENSERP_ENGINES=google,yandex,bing,baidu`, merged). Yandex/Bing
  have broad English indexes; Baidu also returns English results. Google contributes
  when not captcha'd (engine-level fallback covers it otherwise).
- **openserp fallback:** the container runs with `--allow_endpoint_fallback`, so
  even a direct `/google/search` call degrades to a working engine instead of
  failing. (Verified: `/google/search` → `engines_failed:[google]` → results from
  `yandex`.)

## How HD-Search configures openserp

Container flags (in `docker-compose.yml`) — mirrored/documented in
`openserp/config.yaml`:

| Flag | Value | Why |
|---|---|---|
| `--allow_endpoint_fallback` | on | captcha'd engine falls back to a working one |
| `--timeout` | 20 | per-request browser timeout |
| `--max_retries` | 2 | retry transient failures |
| `--cache_ttl` / `--cache_max_size` | 600s / 2000 | openserp-side response cache (on top of HD-Search's Redis cache) |
| `--cb_failures` / `--cb_recovery` | 3 / 120 | circuit breaker: stop hammering a failing engine, retry later |
| `-l` (leakless) | on | always close browser instances after a search |

HD-Search side (env):

| Var | Default | Meaning |
|---|---|---|
| `HDSEARCH_OPENSERP_URL` | `http://127.0.0.1:7007` | endpoint |
| `HDSEARCH_OPENSERP_ENGINES` | `google,yandex,bing,baidu` | engines fanned out + merged (when `HDSEARCH_OPENSERP_MERGE=true`) |
| `HDSEARCH_OPENSERP_MERGE` | `true` | merge all engines' results; `false` = first-with-results |
| `HDSEARCH_OPENSERP_TIMEOUT_MS` | `30000` | per-engine timeout (browser scrapes are slow) |
| `HDSEARCH_OPENSERP_ENGINE` | `yandex` | single-engine fallback if `_ENGINES` unset |

## Making Google work (production)

Google becomes usable with either of these (both optional, configured in
`openserp/config.yaml`):

1. **Residential / rotating proxies** — `proxies.global` (and per-engine
   `proxies.google`). Datacenter proxies won't help; use residential.
2. **2captcha** — set `2captcha_key` so openserp auto-solves the captcha (paid,
   adds latency).

With either in place, Google contributes reliably to the merged
`google,yandex,bing,baidu` result set.

## Priority & latency

- In `priorities.csv`, **searxng (10) is tried before openserp (20)** because
  searxng is faster (no per-query browser spin-up) and aggregates 50+ engines.
  openserp is the secondary self-hosted web source.
- A live openserp query takes ~5–7s (headless browser); HD-Search's Redis cache
  (per-source TTL) makes repeats instant, and aggregate mode's soft deadline keeps
  one slow engine from stalling a response.

## Quick checks

```bash
# health
curl localhost:7007/health
# direct engine (works without proxies)
curl "localhost:7007/yandex/search?text=vector+database&limit=3" | jq '.results[].title'
# through HD-Search
curl localhost:8791/v1/search -H "authorization: Bearer sk-hds-…" \
  -H 'content-type: application/json' -d '{"q":"vector database","engine":"openserp"}'
```
