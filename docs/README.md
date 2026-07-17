# HD-Search Documentation

| Doc | What's inside |
|---|---|
| [QUICKSTART_DEPLOY.md](QUICKSTART_DEPLOY.md) | **Start here** — run the self-hosted stack in one command, first-run admin, provider keys, prod checklist. |
| [CONFIGURATION_DEPLOYMENT.md](CONFIGURATION_DEPLOYMENT.md) | Full self-host reference: run, configuration surface (non-secret), the auto-generated secrets model, providers, local auth, MCP. |
| [AUTH-CONFIG.md](AUTH-CONFIG.md) | **Auth configuration** — local email + password, first-run admin, open-signup, DB-role RBAC, scrypt hashing, troubleshooting. |
| [OPEN_SOURCE_MIGRATION.md](OPEN_SOURCE_MIGRATION.md) | How this went from a SaaS-shaped product to a free, self-hostable app — phased plan, architecture, and the secrets model. |
| [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md) | Architecture, request lifecycle, provider plugin system, caching, vector search, data model, local auth, BFF. |
| [PRD.md](PRD.md) | Product requirements: problem, personas, goals, functional/NFR, metrics, risks. |
| [AI_MODE_SPEC.md](AI_MODE_SPEC.md) | The AI Search / agentic answer mode — orchestration, tools, streaming, persistence. |
| [file-upload-rag.md](file-upload-rag.md) | File upload → parse → embed → index (RAG over your own documents). |
| [aisearch-persistence.md](aisearch-persistence.md) | How AI threads and search history are persisted. |
| [apps-mcp.md](apps-mcp.md) | MCP server + app integrations. |
| [PERFORMANCE_SCALE_SECURITY.md](PERFORMANCE_SCALE_SECURITY.md) | **Performance · Scale · Security · Resiliency** — latency tuning, horizontal/datastore scale, the security model, and the degrade-don't-fail resiliency model. |
| [OPENSERP.md](OPENSERP.md) | How HD-Search configures & leverages OpenSERP's engines (Google/Yandex/Baidu), captcha handling, proxies/2captcha. |
| [DARKWEB_SEARCH.md](DARKWEB_SEARCH.md) | Free/OSS/commercial darkweb search landscape + how to add onion-proxied engines. |
| [HDSEARCH_HDFEEDS_TRENDS_PRD.md](HDSEARCH_HDFEEDS_TRENDS_PRD.md) | The optional trends panel (hd-feeds integration). |

Start with the [project README](../README.md) for a quick tour and run commands.
