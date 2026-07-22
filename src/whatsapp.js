import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from 'baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { config } from './config.js';
import { generateReply, clearHistory } from './openai.js';
import { getTodos, formatTodos, getModel, setModel } from './store.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

// A few models offered by the /model command (any valid id also works).
const MODEL_SUGGESTIONS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini'];

// The live socket; reassigned on reconnect so helpers always use the latest.
let currentSock = null;

/** Send a text message using the current connection. */
export async function sendText(jid, text) {
  if (!currentSock) throw new Error('WhatsApp socket not ready');
  return currentSock.sendMessage(jid, { text });
}

/** Pull plain text out of a Baileys message object. */
function extractText(msg) {
  const m = msg.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  ).trim();
}

const HELP = `🤖 *Commands*
/list — show your to-do list
/model — show or change the AI model (e.g. /model gpt-4o)
/reset — clear conversation memory
/ping — health check
/help — this message

Or just chat naturally — tell me your tasks, ask "what's on my list?", say "mark 2 done", etc.`;

/** Handle slash commands. Returns true if the message was a command. */
async function handleCommand(jid, text) {
  const [cmd, ...rest] = text.trim().split(/\s+/);
  const arg = rest.join(' ').trim();

  switch (cmd.toLowerCase()) {
    case '/help':
      await sendText(jid, HELP);
      return true;

    case '/ping':
      await sendText(jid, 'pong 🏓');
      return true;

    case '/reset':
      clearHistory(jid);
      await sendText(jid, '🧹 Conversation memory cleared. (Your to-dos are kept.)');
      return true;

    case '/list': {
      const todos = await getTodos(jid);
      await sendText(jid, formatTodos(todos));
      return true;
    }

    case '/model': {
      if (!arg) {
        const current = await getModel();
        await sendText(
          jid,
          `🧠 Current model: *${current}*\n\nChange with e.g. \`/model gpt-4o\`\nSuggestions: ${MODEL_SUGGESTIONS.join(', ')}`
        );
      } else {
        const chosen = await setModel(arg);
        await sendText(jid, `✅ Model set to *${chosen}*.`);
      }
      return true;
    }

    default:
      return false;
  }
}

export async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
  });
  currentSock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 Scan this QR code in WhatsApp → Linked Devices:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log('✅ WhatsApp connected. Bot is live.');
      console.log(`🔒 Only replying to: ${config.allowedNumber}`);
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.log(
        `⚠️  Connection closed (code ${statusCode}).` +
          (loggedOut ? ' Logged out — delete the auth folder and re-scan.' : ' Reconnecting...')
      );
      if (!loggedOut) startBot();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;

      // 🔒 Whitelist: only respond to the one allowed number.
      if (jid !== config.allowedJid) {
        logger.info({ jid }, 'Ignored message from non-whitelisted chat');
        continue;
      }

      const text = extractText(msg);
      if (!text) continue;

      console.log(`💬 ${config.allowedNumber}: ${text}`);

      try {
        await sock.sendPresenceUpdate('composing', jid);

        if (text.startsWith('/')) {
          const handled = await handleCommand(jid, text);
          if (handled) continue;
        }

        const reply = await generateReply(jid, text);
        await sendText(jid, reply);
        console.log(`🤖 bot: ${reply}`);
      } catch (err) {
        console.error('Error handling message:', err);
        await sendText(jid, '⚠️ Something went wrong. Try again.').catch(() => {});
      }
    }
  });

  return sock;
}
