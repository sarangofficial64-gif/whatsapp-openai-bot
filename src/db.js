import pg from 'pg';
import { config } from './config.js';

let pool = null;
let schemaReady = null;

export function isDbConfigured() {
  return Boolean(config.databaseUrl);
}

function getPool() {
  if (!pool) {
    pool = new pg.Pool({ connectionString: config.databaseUrl, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = getPool();
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      await client.query(`
        CREATE TABLE IF NOT EXISTS knowledge_items (
          id SERIAL PRIMARY KEY,
          jid TEXT NOT NULL,
          kind TEXT NOT NULL,
          content TEXT NOT NULL,
          source_text TEXT,
          drive_link TEXT,
          embedding VECTOR(1536) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS knowledge_items_embedding_idx
        ON knowledge_items USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
      `);
    })();
  }
  return schemaReady;
}

/** Run a query, ensuring the schema exists first. */
export async function query(text, params) {
  if (!isDbConfigured()) throw new Error("Storage isn't configured yet (DATABASE_URL missing).");
  await ensureSchema();
  return getPool().query(text, params);
}
