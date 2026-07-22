import { query, isDbConfigured } from './db.js';
import { embed } from './embeddings.js';
import { fetchLinkContext } from './linkPreview.js';

const URL_RE = /^https?:\/\/\S+$/i;

/** text/link detection: a message that's just a URL is stored as kind "link". */
export function detectTextKind(text) {
  return URL_RE.test(text.trim()) ? 'link' : 'text';
}

/**
 * Builds the {kind, content} to store for a piece of text. Links get the
 * page's title/description fetched and appended so they're actually
 * findable by meaning later — a bare URL has almost no semantic signal.
 */
export async function prepareTextItem(text) {
  const trimmed = text.trim();
  const kind = detectTextKind(trimmed);

  if (kind === 'link') {
    const ctx = await fetchLinkContext(trimmed);
    if (ctx) {
      const content = [trimmed, ctx.title && `Title: ${ctx.title}`, ctx.description && `Description: ${ctx.description}`]
        .filter(Boolean)
        .join('\n');
      return { kind, content };
    }
  }
  return { kind, content: trimmed };
}

/**
 * Store an item for later semantic search.
 * @param {string} jid
 * @param {string} kind - 'text' | 'link' | 'image' | 'pdf' | 'document'
 * @param {string} content - the text to embed (raw text, vision description, extracted PDF text, etc.)
 * @param {object} [opts]
 * @param {string} [opts.sourceText] - the original message text, if any
 * @param {string} [opts.driveLink] - Drive link, for actual files
 */
export async function storeItem(jid, kind, content, { sourceText, driveLink } = {}) {
  const vector = await embed(content);
  const vectorLiteral = `[${vector.join(',')}]`;
  const res = await query(
    `INSERT INTO knowledge_items (jid, kind, content, source_text, drive_link, embedding)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, kind, content, drive_link, created_at`,
    [jid, kind, content, sourceText || null, driveLink || null, vectorLiteral]
  );
  return res.rows[0];
}

/** Semantic search over a chat's stored items, best matches first. */
export async function searchKnowledge(jid, queryText, limit = 5) {
  const vector = await embed(queryText);
  const vectorLiteral = `[${vector.join(',')}]`;
  const res = await query(
    `SELECT id, kind, content, drive_link, created_at,
            1 - (embedding <=> $2) AS similarity
     FROM knowledge_items
     WHERE jid = $1
     ORDER BY embedding <=> $2
     LIMIT $3`,
    [jid, vectorLiteral, limit]
  );
  return res.rows;
}

export { isDbConfigured };
