# HD-Search Documentation

| Doc | What's inside |
|---|---|
| [QUICKSTART_DEPLOY.md](QUICKSTART_DEPLOY.md) | **Start here** — 5-minute step-by-step deploy (local one-command + Docker stack + prod checklist). |
| [PRD.md](PRD.md) | Product requirements: problem, personas, goals, functional/NFR, plans, metrics, risks, rollout. |
| [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md) | Architecture, request lifecycle, provider plugin system, caching, vector search, data model, auth, billing, BFF. |
| [CONFIGURATION_DEPLOYMENT.md](CONFIGURATION_DEPLOYMENT.md) | Step-by-step: DB setup, env reference, run modes, providers, Auth0, MCP, production deploy. |
| [AUTH-CONFIG.md](AUTH-CONFIG.md) | **Auth configuration — step by step.** Dev login vs Auth0 SSO, the secure PKCE/BFF flow, web + API env reference, auth modes, verify & troubleshooting. |
| [AUTH_PLAN_INTEGRATION.md](AUTH_PLAN_INTEGRATION.md) | Design: consolidating auth + plans with hackerdogs-core (SSO, JWT, plan mapping, rollout). |
| [PERFORMANCE_SCALE_SECURITY.md](PERFORMANCE_SCALE_SECURITY.md) | **Performance · Scale · Security · Resiliency** — latency budget & tuning, horizontal/datastore scale, full security model + hardening checklist, and the degrade-don't-fail resiliency model. |
| [OPENSERP.md](OPENSERP.md) | How HD-Search configures & leverages OpenSERP's engines (Google/Yandex/Baidu), captcha handling, proxies/2captcha. |
| [DARKWEB_SEARCH.md](DARKWEB_SEARCH.md) | Exhaustive free/OSS/commercial darkweb search landscape + how to add onion-proxied engines. |
| [../api/db/CREDENTIALS.md](../api/db/CREDENTIALS.md) | Database roles, dev passwords, connection strings, setup commands. |

Start with the [project README](../README.md) for a quick tour and run commands.
