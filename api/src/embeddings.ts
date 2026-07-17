// Pluggable embeddings (decision: default self-hosted MiniLM). Same plugin shape
// as search/crawl providers so a new embedder is a drop-in. Two ship by default:
//   • minilm  — the already-running transformers-inference container on hdnet
//               (sentence-transformers multi-qa-MiniLM-L6-cos-v1, 384-dim). Free.
//   • openai  — text-embedding-3-small (1536-dim). Needs OPENAI_API_KEY.
// Select with HDSEARCH_EMBEDDINGS_PROVIDER. The vector index dimension must match
// (HDSEARCH_VECTOR_DIM) — minilm=384, openai-3-small=1536.
import { env } from './env.js';
import { httpJson, ProviderError } from './http.js';

export interface Embedder {
  id: string;
  dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

// ---- self-hosted MiniLM via Weaviate transformers-inference (/vectors) --------
const minilm: Embedder = {
  id: 'minilm',
  dim: 384,
  async embed(texts: string[]): Promise<number[][]> {
    // transformers-inference exposes POST /vectors {text} -> {vector:[...]}
    const out: number[][] = [];
    for (const text of texts) {
      const data = await httpJson<{ vector: number[] }>(`${env.embeddingsUrl.replace(/\/$/, '')}/vectors`, {
        provider: 'minilm',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        timeoutMs: env.embeddingsTimeoutMs,
      });
      if (!Array.isArray(data.vector)) throw new ProviderError('minilm', 'no vector returned', 502, false);
      out.push(data.vector);
    }
    return out;
  },
};

// ---- OpenAI embeddings --------------------------------------------------------
const openai: Embedder = {
  id: 'openai',
  dim: 1536,
  async embed(texts: string[]): Promise<number[][]> {
    if (!env.openaiKey) throw new ProviderError('openai', 'OPENAI_API_KEY not set', 401, false);
    const data = await httpJson<{ data: { embedding: number[] }[] }>('https://api.openai.com/v1/embeddings', {
      provider: 'openai',
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.openaiKey}` },
      body: JSON.stringify({ model: env.openaiEmbeddingModel, input: texts }),
      timeoutMs: env.embeddingsTimeoutMs,
    });
    return data.data.map((d) => d.embedding);
  },
};

const REGISTRY: Record<string, Embedder> = { minilm, openai };

export function getEmbedder(): Embedder {
  return REGISTRY[env.embeddingsProvider] || minilm;
}

export function embeddingsEnabled(): boolean {
  return env.embeddingsProvider !== 'none';
}

/** Float32 → buffer for RediSearch VECTOR fields (FLAT/HNSW, type FLOAT32). */
export function vectorToBuffer(vec: number[]): Buffer {
  const f32 = new Float32Array(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}
