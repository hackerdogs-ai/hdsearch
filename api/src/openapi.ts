// Hand-written OpenAPI 3.1 document. Served at /openapi.json and rendered by the
// Documentation UI page. Kept terse but complete for the public endpoints.
import { MODALITIES } from './types.js';

export function openapiDoc() {
  const bearer = [{ ApiKeyAuth: [] }];
  return {
    openapi: '3.1.0',
    info: {
      title: 'hdsearch API',
      version: '1.0.0',
      description:
        'Search + crawl + vector-search aggregator. Priority-ordered provider fallback, Redis cache, per-user encrypted keys.',
    },
    servers: [{ url: '/' }],
    security: bearer,
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'sk-hds-…' },
      },
    },
    paths: {
      '/v1/search': {
        post: {
          summary: 'Aggregated search across engines',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['q'],
                  properties: {
                    q: { type: 'string' },
                    modality: { type: 'string', enum: [...MODALITIES], default: 'web' },
                    engine: { type: 'string', description: 'force a specific engine (e.g. brave)' },
                    mode: { type: 'string', enum: ['fallback', 'aggregate'], default: 'fallback' },
                    limit: { type: 'integer', default: 20 },
                    page: { type: 'integer', default: 1 },
                    country: { type: 'string' },
                    lang: { type: 'string' },
                    freshness: { type: 'string' },
                    facets: { type: 'boolean', default: false },
                    noCache: { type: 'boolean', default: false },
                    ttl: {
                      type: 'integer',
                      description:
                        'Redis result-cache TTL in seconds. Admin default used when omitted or above hard max. Ignored when noCache is true.',
                    },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'search results' }, '402': { description: 'quota exceeded' } },
        },
        get: { summary: 'Search (querystring form)', parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } },
      },
      '/v1/search/vector': {
        post: {
          summary: 'Vector (semantic) KNN search over an indexed namespace',
          responses: { '200': { description: 'ok' } },
        },
      },
      '/v1/search/vector/index': {
        post: { summary: 'Embed + index documents into a namespace (TTL default 24h)', responses: { '200': { description: 'ok' } } },
      },
      '/v1/crawl': {
        post: {
          summary: 'Crawl a URL → markdown/text/html/links/images/screenshot/pdf',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['url'],
                  properties: {
                    url: { type: 'string', format: 'uri' },
                    engine: { type: 'string' },
                    formats: { type: 'array', items: { type: 'string', enum: ['markdown', 'text', 'html', 'links', 'images'] } },
                    render: { type: 'boolean' },
                    store: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'crawl result' } },
        },
      },
      '/v1/engines': {
        get: { summary: 'List available search/crawl engines', responses: { '200': { description: 'engine catalog' } } },
      },
      '/v1/engines/{id}': {
        get: { summary: 'Engine details', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } },
      },
      '/v1/keys/api': {
        get: { summary: 'List your API keys', responses: { '200': { description: 'ok' } } },
        post: { summary: 'Create an API key (shown once)', responses: { '201': { description: 'created' } } },
      },
      '/v1/keys/providers': {
        get: { summary: 'List your stored provider credentials (masked)', responses: { '200': { description: 'ok' } } },
        put: { summary: 'Add/update an encrypted provider credential', responses: { '200': { description: 'ok' } } },
      },
      '/v1/account': { get: { summary: 'Profile, plan, current usage', responses: { '200': { description: 'ok' } } } },
      '/v1/account/history': { get: { summary: 'Search history', responses: { '200': { description: 'ok' } } } },
      '/v1/account/dashboard': { get: { summary: 'Dashboard metrics', responses: { '200': { description: 'ok' } } } },
      '/v1/account/plans': { get: { summary: 'Plan catalog', responses: { '200': { description: 'ok' } } } },
      '/v1/trends': {
        get: {
          summary: 'Trends page — recent headlines by category (News, Cybersecurity, Government, Geopolitics)',
          security: [],
          parameters: [
            { name: 'window_hours', in: 'query', schema: { type: 'integer', default: 24 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 12 } },
          ],
          responses: { '200': { description: 'trends bundle' } },
        },
      },
      '/healthz': { get: { summary: 'Deep health check', security: [], responses: { '200': { description: 'ok' } } } },
    },
  };
}
