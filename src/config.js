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
};
