# Darkweb Search — Exhaustive Provider Landscape

The research sheet (`Internet_Search_APIs`) contains **no darkweb sources**, so this
is the gap the spec asked to close. Below is an exhaustive, validated-as-of-2026
catalogue of darkweb search across **free / open-source / commercial**, with notes
on which are wired into HD-Search today and how to add the rest via the plugin
interface (`src/providers/darkweb/*`).

> **Tor note.** Most native engines are `.onion` services reachable **only through
> Tor** (a SOCKS5 proxy). HD-Search ships **Ahmia** (clearnet) and **Torch**
> (onion). Set `HDSEARCH_TOR_PROXY=socks5h://127.0.0.1:9050` (host) /
> `socks5h://hackerdogs-tor-proxy:9050` (compose) to enable onion access — the
> shared `hackerdogs-tor-proxy` container provides it.

## Wired into HD-Search today

| Provider | Access | Status |
|---|---|---|
| **ahmia** | free, clearnet | ✅ working. Ahmia (2026) requires a hidden anti-bot token, so the provider does a two-step: GET home → extract the hidden `<input>` token → `GET /search/?q=…&<token>`. Falls back to Ahmia's **.onion mirror over Tor** if clearnet is blocked. Verified: returns real onion results (marketplaces, forums, …). |
| **torch** | free, onion-only | ✅ wired, **requires `HDSEARCH_TOR_PROXY`**. Configurable onion (`HDSEARCH_TORCH_ONION`), fails soft if the address is down. |
| **intelx** | commercial | ✅ wired, needs `intelx` key (per-user). |

> **Operational note:** Ahmia's clearnet endpoint silently 302-redirects to its
> homepage if the anti-bot token is missing — that's why a naive `?q=` scrape returns
> nothing. The token is randomized per page load, so the home page must be fetched
> each time (the result is then cached per-source TTL).

---

## 1. Free / Open-source — clearnet-reachable (no key)

| Engine | Endpoint | Access | Notes | In HD-Search |
|---|---|---|---|---|
| **Ahmia** | `https://ahmia.fi/search/?q=` | Free, OSS (`ahmia/ahmia-site`) | The de-facto darkweb search; clearnet gateway to Tor hidden services. Filters abuse content. | ✅ `ahmia` |
| **OnionLand Search** | `https://onionlandsearchengine.com/` (+ onion) | Free | Large onion index, clearnet mirror. | plugin-ready |
| **dark.fail** | `https://dark.fail/` | Free | Verified-onion-link directory (PGP-signed), good for resolving canonical onions. | plugin-ready |
| **Tor.taxi / Daunt** | clearnet directories | Free | Curated, vetted onion link lists. | plugin-ready |

## 2. Free / native — `.onion` only (require Tor proxy)

| Engine | Onion / note | Access |
|---|---|---|
| **Torch** | `torchdeedp3i2jigzjdmfpn5ttjhthh5wbmda2rr3jvqjg5p77c54dqd.onion` | Oldest Tor search engine; large but noisy index. |
| **Haystak** | `haystak5njsmn2hqkewecpaxetahtwhsbsa64jom2k22z5afxhnpxfid.onion` | Very large index; **paid API tier** also exists (see §3). |
| **Candle** | onion | Google-style minimal Tor search. |
| **Tor66 / Phobos / Excavator / TorDex / Deep Search / Senator** | onion | Mid-size onion indexes; commonly aggregated by OnionSearch. |
| **Kilos / Recon** | onion | Darknet-market & vendor search (DNM-focused). |

## 3. Open-source meta-aggregators & crawlers (self-hosted)

These scrape several onion engines at once — the same "aggregate" pattern HD-Search
uses. Best run as a sidecar with a Tor proxy; wrap with a thin provider.

| Tool | Repo | What it does |
|---|---|---|
| **OnionSearch** | `megadose/OnionSearch` | Scrapes Ahmia, Torch, Haystak, Tor66, Phobos, Candle, Deep Search, etc. CLI/lib. |
| **TorBot** | `DedSecInside/TorBot` | OSINT crawler for `.onion`; link graph + metadata extraction. |
| **Fresh Onions** | `dirtyfilthy/freshonions-torscraper` | Self-hosted onion crawler + searchable DB. |
| **OnionScan** | `s-rah/onionscan` | Hidden-service recon/scanner (operational intel, not search). |
| **VigilantOnion / Onioff / darc** | various | Onion monitoring & crawling utilities. |

> ⚠️ Historical: **DarkSearch.io** offered a clean free REST API + Python client
> (`darksearch`) but **shut down in 2022**. Do not build new integrations against it.

## 4. Commercial darkweb intelligence APIs (per-user key)

These are real, supported JSON APIs — the right fit for HD-Search's "commercial,
per-user encrypted key" tier.

| Provider | API | Coverage |
|---|---|---|
| **Intelligence X** | `https://2.intelx.io` | Darkweb, leaks, pastes, breaches, whois history. **✅ wired (`intelx`)** |
| **Webz.io Dark Web API** | REST | Crawled dark-web posts/marketplaces/forums as structured JSON. |
| **DarkOwl Vision** | REST | One of the largest commercial darknet content stores. |
| **Flare** | `https://api.flare.io` | Darkweb + leak monitoring, identity exposure. |
| **Cybersixgill (Sixgill)** | REST | Deep/dark-web threat intel, automated collection. |
| **Searchlight Cyber** (DarkIQ / Cerberus) | REST | Darknet monitoring & investigation. |
| **Flashpoint Ignite** | REST | Illicit communities, DNMs, threat actor intel. |
| **KELA DARKBEAST** | REST | Darknet sources & cybercrime intel. |
| **Recorded Future** | REST | Dark-web intelligence module. |
| **DeHashed / SpyCloud / Constella / HIBP** | REST | Breach & credential-exposure data (overlaps "leaks"; HIBP is in the source sheet). |

---

## Adding more (plugin pattern)

Each darkweb source is one file in `src/providers/darkweb/` exporting a
`SearchProvider` with `category: 'darkweb'`, registered in `src/providers/index.ts`.

- **Clearnet engines** (OnionLand, dark.fail): same shape as `ahmia.ts` — fetch +
  parse, no key.
- **Onion-only engines** (Torch, Haystak): add a Tor-proxied `fetch` agent driven by
  `HDSEARCH_TOR_PROXY`; otherwise identical.
- **Commercial APIs** (Webz.io, DarkOwl, Flare…): same shape as `intelx.ts`, declare
  `accessType: 'commercial'` and `requiresKeys: ['<field>']` so credentials resolve
  from the per-user encrypted store (dev `.env` fallback in `RUN_MODE=dev`).

Priority in `src/priorities.csv` keeps free/self-hosted darkweb sources above the
commercial ones, consistent with the rest of the engine.
