import { db } from '../Config/Db.Config.js';
import { env } from '../Config/Env.Config.js';
import { logger } from '../Config/Logger.Config.js';

const EMBEDDING_DIMS = 1536;
const EMBEDDING_MODEL = 'text-embedding-3-small';

export function embeddingEnabled(): boolean {
  return !!env.OPENAI_API_KEY;
}

async function fetchEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: text.slice(0, 8000), model: EMBEDDING_MODEL }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI embeddings API ${response.status}: ${err}`);
  }

  const data = await response.json() as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export async function updateEmbedding(path: string, projectSlug: string, content: string): Promise<void> {
  if (!embeddingEnabled()) return;

  try {
    const embedding = await fetchEmbedding(content);
    const vector = vectorLiteral(embedding);

    await db.$executeRaw`
      INSERT INTO vault_embeddings (id, path, project_slug, content, embedding, updated_at)
      VALUES (gen_random_uuid()::text, ${path}, ${projectSlug}, ${content}, ${vector}::vector, now())
      ON CONFLICT (path) DO UPDATE
        SET project_slug = EXCLUDED.project_slug,
            content = EXCLUDED.content,
            embedding = EXCLUDED.embedding,
            updated_at = now()
    `;
  } catch (err) {
    logger.warn({ err, path }, 'embedding update failed');
  }
}

export async function deleteEmbedding(path: string): Promise<void> {
  if (!embeddingEnabled()) return;
  try {
    await db.$executeRaw`DELETE FROM vault_embeddings WHERE path = ${path}`;
  } catch {
    // non-critical
  }
}

export interface SemanticMatch {
  path: string;
  projectSlug: string;
  content: string;
  similarity: number;
}

export async function semanticSearch(
  query: string,
  projectSlug?: string,
  limit = 10,
): Promise<SemanticMatch[]> {
  if (!embeddingEnabled()) return [];

  const queryEmbedding = await fetchEmbedding(query);
  const vector = vectorLiteral(queryEmbedding);

  type Row = { path: string; project_slug: string; content: string; similarity: number };

  const rows = projectSlug
    ? await db.$queryRaw<Row[]>`
        SELECT path, project_slug, content,
               1 - (embedding <=> ${vector}::vector) AS similarity
        FROM vault_embeddings
        WHERE project_slug = ${projectSlug}
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${vector}::vector
        LIMIT ${limit}
      `
    : await db.$queryRaw<Row[]>`
        SELECT path, project_slug, content,
               1 - (embedding <=> ${vector}::vector) AS similarity
        FROM vault_embeddings
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> ${vector}::vector
        LIMIT ${limit}
      `;

  return rows.map((r) => ({
    path: r.path,
    projectSlug: r.project_slug,
    content: r.content,
    similarity: Number(r.similarity),
  }));
}

export async function getEmbeddingStats(): Promise<{ total: number; withEmbedding: number }> {
  if (!embeddingEnabled()) return { total: 0, withEmbedding: 0 };

  type CountRow = { total: bigint; with_embedding: bigint };
  const [row] = await db.$queryRaw<CountRow[]>`
    SELECT COUNT(*) AS total,
           COUNT(embedding) AS with_embedding
    FROM vault_embeddings
  `;

  return {
    total: Number(row.total),
    withEmbedding: Number(row.with_embedding),
  };
}
