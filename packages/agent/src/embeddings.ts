export const EMBEDDING_DIMENSIONS = 1536;

function embeddingConfig() {
  const apiKey =
    process.env.OPENAI_EMBEDDING_API_KEY ||
    (process.env.OPENAI_API_KEY !== 'ollama-local' ? process.env.OPENAI_API_KEY : undefined);
  if (!apiKey) throw new Error('OPENAI_EMBEDDING_API_KEY is required for vector retrieval.');

  return {
    apiKey,
    model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    baseUrl: (process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  };
}

export async function createEmbeddings(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const config = embeddingConfig();
  const response = await fetch(`${config.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: config.model, input: inputs }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Embedding request failed (${response.status}): ${body.slice(0, 400)}`);
  }

  const result = (await response.json()) as {
    data?: Array<{ index: number; embedding: number[] }>;
  };
  const embeddings = (result.data ?? [])
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);

  if (embeddings.length !== inputs.length) {
    throw new Error(`Embedding response count mismatch: expected ${inputs.length}, received ${embeddings.length}.`);
  }
  for (const vector of embeddings) {
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding dimension mismatch: expected ${EMBEDDING_DIMENSIONS}, received ${vector.length}.`
      );
    }
  }

  return embeddings;
}

export function toVectorLiteral(vector: number[]): string {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Cannot serialize vector with ${vector.length} dimensions.`);
  }
  return `[${vector.join(',')}]`;
}
