# HDSearch Terms of Service

**Last updated: June 25, 2026**

These Terms of Service ("**Terms**") govern access to and use of HDSearch (the "**Service**"), including the HDSearch website, dashboard, search interface, application programming interfaces ("**API**"), Model Context Protocol ("**MCP**") integrations, and related tools, operated by Hackerdogs ("**Hackerdogs**," "**we**," "**us**," or "**our**").

By creating an account, signing in, or otherwise accessing or using the Service, you agree to these Terms. If you use the Service on behalf of an organization, you represent that you have authority to bind that organization, and "**you**" includes that organization. If you do not agree, do not use the Service.

---

## 1. Eligibility

You must be at least 18 years old (or the age of majority in your jurisdiction) and able to form a binding contract. You may not use the Service if you are barred under applicable law or if we have previously suspended or terminated your account.

---

## 2. The Service

HDSearch is a **search and retrieval aggregation platform**. Depending on configuration, plan, and modality, the Service may:

- Query and combine results from third-party search engines, crawl indexes, web archives, geospatial data services, darkweb search tools (where enabled), and AI or language-model providers (collectively, "**Upstream Providers**");
- Retrieve, normalize, cache, and present links, snippets, metadata, maps, archived captures, crawled page content, embeddings, and AI-generated summaries or answers; and
- Expose those capabilities through a web UI, API, MCP tools, and related integrations.

**How results are obtained.** HDSearch does **not** operate its own general web index. Results are obtained through Upstream Providers, which may include:

- **Licensed APIs** (e.g., commercial search APIs, programmable search engines, mapping APIs, LLM APIs) when valid credentials are supplied or system defaults are enabled;
- **Permitted public interfaces** (e.g., open datasets, archive APIs, wiki APIs) subject to each provider's terms; and
- **Automated retrieval** configured by you or by Hackerdogs (e.g., meta-search engines, headless-browser retrieval, HTTP crawlers, Tor-based queries) where enabled.

**Service URLs.** The Service is offered at [https://hdsearch.ai](https://hdsearch.ai) (web, dashboard, and search UI). Programmatic access is at [https://api.hdsearch.ai](https://api.hdsearch.ai) (REST API and related endpoints).

**No upstream endorsement.** HDSearch is independent of Upstream Providers. Reference to any third-party name, logo, or product does not imply endorsement, partnership, or sponsorship unless expressly stated.

**Provider catalog.** A non-exhaustive list of integrated providers is published within the Service (e.g., the Services page at [https://hdsearch.ai/services](https://hdsearch.ai/services)). Providers, priorities, and availability may change without notice.

---

## 3. Accounts and Security

You are responsible for all activity under your account and for safeguarding your credentials, API keys, and session access. Notify us promptly at **legal@hackerdogs.ai** if you suspect unauthorized access.

We may refuse registration, reclaim usernames, or limit accounts to prevent abuse, fraud, or legal risk.

---

## 4. License to Use the Service

Subject to these Terms and your plan:

**4.1 Web and dashboard use.** We grant you a limited, revocable, non-exclusive, non-transferable, non-sublicensable license to access and use the Service through our web interface and dashboard for your personal use or internal business purposes.

**4.2 API and MCP use.** If your plan includes API or MCP access, we grant you a limited, revocable, non-exclusive, non-transferable license to call the Service programmatically **solely** to build and operate your own applications, workflows, or internal tools, subject to rate limits, usage caps, and the restrictions in Sections 5–7.

**4.3 Restrictions on the license.** Except as expressly permitted by these Terms or mandatory law, you may not:

- Sublicense, resell, lease, or white-label the Service or its outputs as a standalone search, crawl, or SERP API product;
- Remove, obscure, or alter proprietary notices, attribution, or branding required by these Terms or Upstream Providers;
- Use the Service to develop or offer a product that functions substantially the same as the Service or that primarily repackages raw Upstream Provider output for third-party consumption without independent value-add and all required rights; or
- Access the Service to build datasets or models intended to replace or compete with Upstream Providers in violation of their terms.

**4.4 Upstream rights.** Nothing in these Terms grants you any right in third-party content, trademarks, or data. Your rights in search results, crawled content, maps, archives, and AI outputs are limited to what applicable law and the relevant Upstream Provider terms permit.

---

## 5. Upstream Providers — Your Responsibilities

**5.1 Compliance.** You are solely responsible for ensuring that your use of the Service—and any application, product, or workflow you build with it—complies with:

- These Terms;
- All applicable laws and regulations (including copyright, privacy, data protection, export control, and computer-fraud laws);
- The terms of service, API terms, privacy policies, and attribution requirements of every Upstream Provider whose data you access through the Service; and
- Any contractual obligations you have with Upstream Providers (including API key license tiers and permitted use cases).

Your use of HDSearch does **not** exempt you from Upstream Provider terms that apply to your retrieval, display, storage, redistribution, or commercial use of results.

**5.2 Your API keys and configuration.** If you supply API keys, credentials, or provider preferences, you represent that you are authorized to use them for the queries and use cases you submit through the Service. You must not submit keys obtained in violation of an Upstream Provider's terms.

**5.3 No legal advice on upstream use.** Hackerdogs does not provide legal advice regarding whether a particular query path, provider, or use case is permitted by an Upstream Provider. When in doubt, consult qualified counsel and the Upstream Provider directly.

**5.4 Scraping and automated retrieval.** Where the Service uses or enables automated retrieval (including through third-party scrapers, meta-search engines, crawlers, or Tor proxies), you agree **not** to use those paths to access content or services in a manner that violates the target site's or Upstream Provider's terms, robots directives, access controls, or applicable law. Hackerdogs may disable providers or modalities that create undue legal or operational risk.

---

## 6. Attribution and Third-Party Content

**6.1 Required attribution.** When you display, publish, or redistribute content obtained through the Service, you must comply with all attribution and branding requirements imposed by the applicable Upstream Providers and licenses. Without limiting the foregoing, you must not remove or obscure required notices for:

- **Google** and Google-powered results (including via Programmable Search Engine, Custom Search JSON API, SerpAPI, Serper, or similar)—including required "Powered by Google" or equivalent branding when applicable;
- **Brave Search** and other commercial search APIs;
- **Wikipedia** and other wiki content (including Creative Commons attribution requirements);
- **OpenStreetMap** and other open geodata (including "© OpenStreetMap contributors" and ODbL obligations where maps or derived data are shown or redistributed);
- **Internet Archive / Wayback Machine** and other archive services; and
- Any other Upstream Provider that requires source identification, logos, or license text.

**6.2 Third-party content.** Results may include copyrighted material, trademarks, and personal data belonging to third parties. HDSearch does not claim ownership of such material. You are responsible for your subsequent use, reproduction, and distribution of third-party content.

**6.3 No additional rights.** Except for the limited license in Section 4, Hackerdogs grants no rights in Upstream Provider content. If an Upstream Provider's terms prohibit your intended use, you must not use the Service for that purpose.

---

## 7. Prohibited Uses

You agree **not** to use the Service (and not to assist others to use the Service) for any unlawful purpose or in any way that violates these Terms. Without limitation, you must not:

**7.1 Legal and rights violations**

- Violate any applicable law or regulation, including laws governing copyright, trademark, privacy, data protection, defamation, harassment, stalking, child safety, sanctions, and export control;
- Infringe or misappropriate intellectual property, publicity, or privacy rights;
- Access, collect, or use personal data without a lawful basis and required notices; or
- Use the darkweb or Tor-related modalities to facilitate illegal activity, access unlawfully obtained data, or evade law enforcement.

**7.2 Service and upstream abuse**

- Probe, scan, or test the vulnerability of the Service or Upstream Provider systems without authorization;
- Bypass or attempt to bypass authentication, rate limits, captchas, robots rules, geographic restrictions, or other access controls of the Service or any Upstream Provider;
- Use bots, scrapers, crawlers, or bulk automated means to access the **Service** at a scale or manner that imposes an unreasonable burden, circumvents technical limits, or violates your plan;
- Circumvent billing, metering, or abuse-prevention measures;

**7.3 Restricted downstream uses**

- Resell, publicly redistribute, or create searchable databases from raw Service output **except** as expressly permitted by applicable Upstream Provider terms and your plan;
- Use results to train, fine-tune, or evaluate machine-learning models **if** prohibited by the relevant Upstream Provider terms or applicable law;
- Offer a competing general web search engine, SERP API, or crawl API whose primary value is repackaged third-party search or crawl output without all required upstream rights and attributions;
- Sublicense API access to the Service or provide third parties with unauthenticated access to your account or keys;

**7.4 Technical misuse**

- Reverse-engineer, decompile, or attempt to extract source code, models, or non-public algorithms from the Service except where prohibited by law;
- Introduce malware or interfere with the integrity or performance of the Service; or
- Misrepresent the source of data or imply that Hackerdogs or Upstream Providers endorse you or your product.

We may investigate violations and cooperate with law enforcement and Upstream Providers as permitted by law.

---

## 8. AI-Generated Content and Search Results

**8.1 Informational use only.** Search results, AI-generated answers, summaries, citations, maps, charts, weather data, and other outputs are provided **"as is"** for general informational purposes. They:

- May be inaccurate, incomplete, outdated, biased, or misleading;
- Are **not** professional, legal, financial, medical, mental-health, security, or other licensed advice; and
- Do not constitute an endorsement of any person, entity, product, service, or linked source.

**8.2 Verify important information.** You must independently verify anything important against authoritative primary sources before relying on it or acting on it. Hackerdogs is not responsible for decisions you make based on Service outputs.

**8.3 AI limitations.** AI responses reflect limitations of underlying models and training data. Confident-sounding output may still be wrong. Automated tool use (search, crawl, maps, archives) may fail silently or return partial data.

---

## 9. Queries, Data Transmission, and Privacy

**9.1 Query forwarding.** By submitting a query, URL, file, or message, you instruct us to process it and, as needed, transmit it to Upstream Providers (including AI/LLM vendors, search APIs, archive services, crawlers, geocoders, and Tor relays) to generate results.

**9.2 Sensitive and regulated data.** Do **not** submit confidential, proprietary, or sensitive information—including passwords, authentication tokens, payment card data, government IDs, health information, or children's personal data—unless you are legally authorized to share it with the relevant third parties and have appropriate safeguards. The Service is not designed for regulated data processing unless we expressly agree in writing.

**9.3 Logging and retention.** We may log queries, URLs, metadata, usage metrics, and technical diagnostics to operate, secure, bill, and improve the Service. Retention periods vary by feature and plan. Details are described in our Privacy Policy.

**9.4 Model training.** We do not guarantee that Upstream Providers (especially LLM providers) will not use submitted content to improve their models. Do not submit data you are not willing to have processed by third parties.

**9.5 Privacy Policy.** Our Privacy Policy explains how we collect, use, and share personal information. It is available at [https://hdsearch.ai/privacy](https://hdsearch.ai/privacy). By using the Service, you acknowledge that you have read it.

---

## 10. API Keys, Plans, and Billing

**10.1 API keys.** API keys are personal to your account (or your organization). You must keep them secret. You are responsible for all usage attributed to your keys.

**10.2 Plans and limits.** Features, rate limits, credits, provider access, and modalities depend on your plan. We may throttle, queue, or refuse requests that exceed limits or pose abuse risk.

**10.3 Fees.** Paid plans, credits, and third-party pass-through costs (if any) are described at checkout or in your account. Fees are non-refundable except where required by law or expressly stated.

**10.4 Taxes.** You are responsible for applicable taxes except those based on Hackerdogs' net income.

---

## 11. Darkweb and High-Risk Modalities

Where darkweb or Tor-related search is enabled, you may use it only for lawful purposes (e.g., authorized security research, journalism, or academic study with appropriate approvals). You must not use these features to access, distribute, or facilitate illegal content or services. Hackerdogs may disable darkweb modalities at any time.

---

## 12. Hackerdogs Intellectual Property

The Service, including its software, design, documentation, and branding (excluding third-party content), is owned by Hackerdogs or its licensors and protected by intellectual property laws. No rights are granted except as expressly stated in these Terms.

If you provide feedback or suggestions, you grant Hackerdogs a perpetual, irrevocable, worldwide, royalty-free license to use them without restriction or compensation.

---

## 13. Changes to the Service and Terms

We may modify, suspend, or discontinue any part of the Service at any time, including specific providers, modalities, or features.

We may update these Terms from time to time. If we make material changes, we will provide notice (e.g., by posting the updated Terms with a new "Last updated" date, email, or in-product notice) before the changes take effect. **Continued use after the effective date constitutes acceptance.** If you do not agree, you must stop using the Service and may close your account.

---

## 14. Disclaimer of Warranties

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE SERVICE AND ALL OUTPUTS ARE PROVIDED **"AS IS"** AND **"AS AVAILABLE"** WITHOUT WARRANTY OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY, TITLE, QUIET ENJOYMENT, AND NON-INFRINGEMENT.

WITHOUT LIMITING THE FOREGOING, HACKERDOGS DOES NOT WARRANT THAT:

- THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, OR FREE OF HARMFUL COMPONENTS;
- RESULTS WILL BE COMPLETE, CURRENT, OR LAWFULLY OBTAINABLE FOR YOUR INTENDED USE;
- ANY UPSTREAM PROVIDER WILL REMAIN AVAILABLE OR PERMIT YOUR USE; OR
- AI OR AUTOMATED OUTPUTS WILL BE ACCURATE OR FIT FOR ANY PARTICULAR PURPOSE.

Some jurisdictions do not allow exclusion of implied warranties; in those jurisdictions, the above exclusions apply to the fullest extent permitted.

---

## 15. Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW:

**15.1 Exclusion of damages.** HACKERDOGS AND ITS AFFILIATES, OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, AND LICENSORS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUE, DATA, GOODWILL, OR BUSINESS OPPORTUNITY, ARISING OUT OF OR RELATED TO THE SERVICE OR THESE TERMS, WHETHER BASED ON WARRANTY, CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT LIABILITY, OR ANY OTHER THEORY, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

**15.2 Cap.** OUR TOTAL LIABILITY FOR ALL CLAIMS ARISING OUT OF OR RELATING TO THE SERVICE OR THESE TERMS SHALL NOT EXCEED THE GREATER OF (A) THE AMOUNTS YOU PAID TO HACKERDOGS FOR THE SERVICE IN THE TWELVE (12) MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM, OR (B) ONE HUNDRED U.S. DOLLARS (US$100).

**15.3 Upstream claims.** Hackerdogs is not liable for acts, omissions, outages, policy changes, or claims by Upstream Providers, including withdrawal of access, blocking, or enforcement actions against you.

Some jurisdictions do not allow certain limitations; in those jurisdictions, our liability is limited to the greatest extent permitted by law.

---

## 16. Indemnification

You agree to indemnify, defend, and hold harmless Hackerdogs and its affiliates, officers, directors, employees, agents, and licensors from and against any claims, demands, actions, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of or related to:

- Your access to or use of the Service;
- Your applications, products, or services that use the Service;
- Your violation of these Terms;
- Your violation of any law or regulation; or
- Your violation of any third party's rights, including intellectual property, privacy, or the terms of any Upstream Provider.

Hackerdogs may assume exclusive defense and control of any matter subject to indemnification; you agree to cooperate. You may not settle any matter without our prior written consent if it imposes obligations on Hackerdogs.

---

## 17. Termination

We may suspend or terminate your access to the Service immediately, with or without notice, for any reason, including breach of these Terms, legal risk, non-payment, or abuse.

You may stop using the Service at any time. Upon termination, Sections that by nature should survive (including Sections 5–6, 8, 9.2–9.4, 12, 14–16, 18–20) will survive.

---

## 18. Governing Law and Disputes

**18.1 Governing law.** These Terms are governed by the laws of the State of California, United States, without regard to conflict-of-law principles, except that mandatory consumer protection laws in your country of residence may apply where required.

**18.2 Informal resolution.** Before filing a claim, you agree to contact us at **legal@hackerdogs.ai** and attempt to resolve the dispute informally for at least thirty (30) days.

**18.3 Courts.** Except where prohibited by applicable law, any dispute not resolved informally shall be brought exclusively in the state or federal courts located in San Francisco County, California, and you consent to personal jurisdiction and venue in those courts.

**18.4 Class actions.** To the extent permitted by law, disputes must be brought on an individual basis; class, consolidated, or representative actions are not permitted.

---

## 19. Export and Sanctions

You may not use the Service if you are located in, organized under the laws of, or ordinarily resident in a country or region subject to comprehensive U.S. sanctions, or if you are on any U.S. government restricted-party list. You must not use the Service for prohibited end uses under U.S. export control laws.

---

## 20. General

**20.1 Entire agreement.** These Terms, together with the Privacy Policy and any order form or plan terms expressly incorporated by reference, constitute the entire agreement between you and Hackerdogs regarding the Service.

**20.2 Severability.** If any provision is held invalid or unenforceable, the remaining provisions remain in effect.

**20.3 No waiver.** Failure to enforce a provision is not a waiver.

**20.4 Assignment.** You may not assign these Terms without our prior written consent. We may assign these Terms without restriction.

**20.5 Force majeure.** We are not liable for delays or failures caused by events beyond our reasonable control.

**20.6 Third-party beneficiaries.** Upstream Providers are intended third-party beneficiaries of Sections 5, 6, 7, 15.3, and 16 solely to the extent necessary to enforce their terms against you.

---

## 21. Contact

Questions about these Terms:

**Hackerdogs**  
Email: **legal@hackerdogs.ai**  
Web: [https://hdsearch.ai](https://hdsearch.ai)  
API: [https://api.hdsearch.ai](https://api.hdsearch.ai)  
Parent: [https://hackerdogs.ai](https://hackerdogs.ai)
