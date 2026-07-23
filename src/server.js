import http from 'http';
import QRImage from 'qrcode';
import { config } from './config.js';
import { handleOAuthCallback } from './google.js';
import { getCurrentQr } from './qrState.js';

/**
 * Minimal HTTP server: handles the Google OAuth redirect and doubles as a
 * health check (useful on Railway/Render, which like a bound port).
 */
export function startServer(onDriveAuthed) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/oauth2callback') {
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h2>Google sign-in was cancelled or failed: ${error}</h2>`);
        return;
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h2>Missing authorization code.</h2>');
        return;
      }

      try {
        const redirectUri = `${config.publicUrl}/oauth2callback`;
        await handleOAuthCallback(code, redirectUri);
        console.log('☁️  Google Drive connected.');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>✅ Google Drive connected! You can close this tab.</h2>');
        onDriveAuthed?.();
      } catch (err) {
        console.error('OAuth callback error:', err);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<h2>Something went wrong. Check the bot logs.</h2>');
      }
      return;
    }

    if (url.pathname === '/qr') {
      const qr = getCurrentQr();
      if (!qr) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>No QR pending right now — either already connected, or still starting up (refresh in a few seconds).</h2>');
        return;
      }
      try {
        const png = await QRImage.toBuffer(qr, { width: 512, margin: 2 });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        res.end(png);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h2>Failed to render QR: ${err.message}</h2>`);
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WhatsApp bot is running.');
  });

  server.listen(config.port, () => {
    console.log(`🌐 Server listening on port ${config.port} (OAuth callback + health check)`);
  });

  return server;
}
