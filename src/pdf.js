import { PDFParse } from 'pdf-parse';
import { config } from './config.js';

const LLAMA_BASE = 'https://api.cloud.llamaindex.ai/api/parsing';
const LLAMA_POLL_INTERVAL_MS = 2000;
const LLAMA_JOB_TIMEOUT_MS = 90_000;

async function llamaHeaders() {
  return { Authorization: `Bearer ${config.llamaCloudApiKey}` };
}

/** Parses a PDF via LlamaParse (handles scans, tables, complex layouts via OCR). */
async function llamaParsePdf(buffer, filename) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/pdf' }), filename || 'document.pdf');

  const uploadRes = await fetch(`${LLAMA_BASE}/upload`, {
    method: 'POST',
    headers: await llamaHeaders(),
    body: form,
  });
  if (!uploadRes.ok) throw new Error(`LlamaParse upload failed: ${uploadRes.status}`);
  const { id: jobId } = await uploadRes.json();

  const deadline = Date.now() + LLAMA_JOB_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, LLAMA_POLL_INTERVAL_MS));

    const statusRes = await fetch(`${LLAMA_BASE}/job/${jobId}`, { headers: await llamaHeaders() });
    if (!statusRes.ok) throw new Error(`LlamaParse status check failed: ${statusRes.status}`);
    const status = await statusRes.json();

    if (status.status === 'SUCCESS') {
      const resultRes = await fetch(`${LLAMA_BASE}/job/${jobId}/result/markdown`, { headers: await llamaHeaders() });
      if (!resultRes.ok) throw new Error(`LlamaParse result fetch failed: ${resultRes.status}`);
      const { markdown } = await resultRes.json();
      return (markdown || '').trim();
    }
    if (status.status === 'ERROR') {
      throw new Error(`LlamaParse job failed: ${status.error || 'unknown error'}`);
    }
    // else still PENDING — keep polling
  }
  throw new Error('LlamaParse job timed out');
}

/** Local fallback: fast, but can't read scanned/image-only PDFs. */
async function localPdfText(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return (result.text || '').trim();
  } finally {
    await parser.destroy();
  }
}

/** Extracts text from a PDF buffer, preferring LlamaParse when configured. */
export async function extractPdfText(buffer, filename) {
  if (config.llamaCloudApiKey) {
    try {
      const text = await llamaParsePdf(buffer, filename);
      if (text) return text.slice(0, 8000);
    } catch (err) {
      console.error('LlamaParse failed, falling back to local extraction:', err);
    }
  }
  try {
    return (await localPdfText(buffer)).slice(0, 6000);
  } catch (err) {
    console.error('PDF text extraction failed:', err);
    return '';
  }
}
