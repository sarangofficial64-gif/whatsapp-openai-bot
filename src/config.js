import 'dotenv/config';

/**
 * Central config, loaded from environment variables.
 * On Railway, set these in the service "Variables" tab.
 */

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

// The one WhatsApp number the bot is allowed to talk to.
// Digits only, INCLUDING country code, no "+" or spaces.
// Example for India (+91) 12345 67890  ->  "911234567890"
const ALLOWED_NUMBER = required('ALLOWED_NUMBER').replace(/\D/g, '');
if (!ALLOWED_NUMBER) {
  console.error('❌ ALLOWED_NUMBER has no digits after stripping non-numeric characters — the bot would reject every message.');
  process.exit(1);
}

// A PUBLIC_URL without a scheme silently breaks the OAuth redirect URI
// (we just concatenate it), so catch that misconfiguration at startup
// instead of failing mysteriously later inside the Google auth flow.
if (process.env.PUBLIC_URL && !/^https?:\/\//i.test(process.env.PUBLIC_URL)) {
  console.error(`❌ PUBLIC_URL is missing "http://" or "https://": "${process.env.PUBLIC_URL}"`);
  process.exit(1);
}

export const config = {
  openaiApiKey: required('OPENAI_API_KEY'),
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  systemPrompt:
    process.env.SYSTEM_PROMPT ||
    'You are a helpful, concise WhatsApp assistant. Keep replies short and friendly.',

  allowedNumber: ALLOWED_NUMBER,
  // WhatsApp JID for a personal chat, e.g. "911234567890@s.whatsapp.net"
  allowedJid: `${ALLOWED_NUMBER}@s.whatsapp.net`,

  // Where Baileys stores the login session. On Railway, point this at a
  // mounted volume so you don't have to re-scan the QR on every deploy.
  authDir: process.env.AUTH_DIR || './auth',

  // Where persistent app data (todos, settings) is stored. Put this on the
  // Railway volume too, e.g. /data.
  dataDir: process.env.DATA_DIR || './data',

  // How many past messages to keep as context per chat.
  historyLimit: Number(process.env.HISTORY_LIMIT || 12),

  // Daily to-do prompt: cron expression + timezone.
  // Default: 10:00 every day, India Standard Time.
  dailyCron: process.env.DAILY_CRON || '0 10 * * *',
  timezone: process.env.TIMEZONE || 'Asia/Kolkata',

  // Fixed daily reminders beyond the morning to-do prompt (cron + message).
  dailyReminders: [
    {
      cron: process.env.KEKA_LOGIN_CRON || '45 9 * * *',
      message: process.env.KEKA_LOGIN_MESSAGE || '🔔 Reminder: log in to Keka!',
    },
    {
      cron: process.env.KEKA_LOGOUT_CRON || '30 18 * * *',
      message: process.env.KEKA_LOGOUT_MESSAGE || '🔔 Reminder: log out of Keka!',
      escalate: true,
    },
  ],

  // Model used to transcribe voice notes.
  transcribeModel: process.env.TRANSCRIBE_MODEL || 'whisper-1',

  // Google Drive OAuth (optional — only needed if you use /driveauth).
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',

  // Neon Postgres (optional — only needed for /store and knowledge search).
  databaseUrl: process.env.DATABASE_URL || '',
  embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',

  // LlamaParse (optional — better PDF text extraction, incl. scanned PDFs).
  // Falls back to local parsing when not set.
  llamaCloudApiKey: process.env.LLAMA_CLOUD_API_KEY || '',

  // Small HTTP server used only for the Google OAuth redirect + health check.
  port: Number(process.env.PORT || 8080),
  // Public base URL Google redirects back to after consent.
  // Local testing: leave default (http://localhost:PORT) and open the
  // /driveauth link on the SAME machine running the bot.
  // Railway/Render: set to your public service URL, e.g.
  // https://your-app.up.railway.app
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${Number(process.env.PORT || 8080)}`).replace(/\/$/, ''),
};
