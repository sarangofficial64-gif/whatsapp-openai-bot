// Shares the current pending WhatsApp login QR between whatsapp.js (producer)
// and server.js (consumer, via the /qr HTTP route) — avoids squished/garbled
// QR rendering in a remote log viewer like Railway's.

let currentQr = null;

export function setCurrentQr(qr) {
  currentQr = qr;
}

export function getCurrentQr() {
  return currentQr;
}
