import * as cheerio from 'cheerio';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 2_000_000; // cap page size; we only need the <head>

/** Fetches a URL and pulls a title + description for context. Returns null on any failure. */
export async function fetchLinkContext(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WhatsAppBot/1.0)' },
    });
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') || '').includes('text/html')) return null;

    const buf = await res.arrayBuffer();
    const html = Buffer.from(buf.slice(0, MAX_BYTES)).toString('utf8');
    const $ = cheerio.load(html);

    const title = ($('meta[property="og:title"]').attr('content') || $('title').first().text() || '').trim();
    const description = (
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      ''
    ).trim();

    if (!title && !description) return null;
    return { title: title.slice(0, 200), description: description.slice(0, 500) };
  } catch (err) {
    console.error(`Link preview failed for ${url}:`, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
