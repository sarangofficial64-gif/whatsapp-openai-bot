/**
 * Thin wrapper around the live WhatsApp socket so other modules (openai.js,
 * scheduler.js) can send messages without importing whatsapp.js directly
 * (which would create a circular import back into openai.js).
 */

let sock = null;

export function setSocket(s) {
  sock = s;
}

export async function sendText(jid, text) {
  if (!sock) throw new Error('WhatsApp socket not ready');
  return sock.sendMessage(jid, { text });
}

export async function sendDocument(jid, buffer, filename, mimetype) {
  if (!sock) throw new Error('WhatsApp socket not ready');
  return sock.sendMessage(jid, { document: buffer, fileName: filename, mimetype });
}
