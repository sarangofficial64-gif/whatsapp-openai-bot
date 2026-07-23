import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from 'baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import QRImage from 'qrcode';
import path from 'path';
import pino from 'pino';
import { config } from './config.js';
import { generateReply, clearHistory } from './openai.js';
import { getTodos, formatTodos, getModel, setModel, setPrimaryJid } from './store.js';
import { setSocket, sendText } from './wa-actions.js';
import { transcribeAudio } from './transcribe.js';
import { describeImage } from './vision.js';
import { getAuthorizedClient, getAuthUrl, isGoogleConfigured } from './google.js';
import { uploadBuffer } from './drive.js';
import { markRead } from './callWatch.js';
import { storeItem, prepareTextItem, isDbConfigured } from './knowledge.js';
import { extractPdfText } from './pdf.js';
import { setCurrentQr } from './qrState.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

const MODEL_SUGGESTIONS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini'];

// jid -> { buffer, filename, mimeType, expiresAt } — a file awaiting a yes/no
// reply on whether to save it to Google Drive.
const pendingAttachments = new Map();
const PENDING_TTL_MS = 5 * 60 * 1000;

// WhatsApp occasionally redelivers the same message (e.g. after a session
// re-key). Track recently-seen message IDs so we don't act on it twice.
const seenMessageIds = new Map();
const SEEN_TTL_MS = 10 * 60 * 1000;

function alreadyHandled(id) {
  const now = Date.now();
  for (const [k, t] of seenMessageIds) if (now - t > SEEN_TTL_MS) seenMessageIds.delete(k);
  if (seenMessageIds.has(id)) return true;
  seenMessageIds.set(id, now);
  return false;
}

// Nothing network-bound (media download, transcription, vision, chat) is
// allowed to hang forever — a stalled call would otherwise freeze that chat.
const MEDIA_TIMEOUT_MS = 45_000;
function withTimeout(promise, label, ms = MEDIA_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);
}

const SAVE_INTENT = /\b(save|upload|store|keep|put)\b/i;
const YES_RE = /^(y|yes|yeah|yup|ok|okay|sure|save|upload)\b/i;
const NO_RE = /^(n|no|nah|nope|cancel|don't|dont)\b/i;

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'application/pdf': 'pdf',
};

function defaultFilename(prefix, mimeType) {
  const ext = EXT_BY_MIME[mimeType] || (mimeType?.split('/')[1] ?? 'bin');
  return `${prefix}_${Date.now()}.${ext}`;
}

function extractText(msg) {
  const m = msg.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  ).trim();
}

async function saveToDrive(jid, buffer, filename, mimeType) {
  try {
    const auth = await getAuthorizedClient();
    const file = await uploadBuffer(auth, buffer, filename, mimeType);
    console.log(`☁️  Saved to Drive: ${file.name} (${file.id})`);
    await sendText(jid, `✅ Saved *${file.name}* to Drive.${file.webViewLink ? `\n${file.webViewLink}` : ''}`);
  } catch (err) {
    console.error('Drive save failed:', err);
    await sendText(jid, `⚠️ Couldn't save to Drive: ${err.message}`);
  }
}

function stripStoreCommand(text) {
  return text.replace(/\/store\b/i, '').trim();
}

/**
 * The real /store pipeline for a media buffer: uploads to Drive AND creates
 * a searchable knowledge-base entry (vision description / extracted PDF
 * text / note). Used for direct "/store" captions, replies, quotes, and now
 * also the plain "save this" flow — every save is searchable, consistently.
 * Falls back to a plain Drive-only save if the knowledge base isn't set up.
 */
async function storeMediaItem(jid, kind, buffer, mimeType, filename, noteText) {
  if (!isDbConfigured()) {
    await saveToDrive(jid, buffer, filename, mimeType);
    return;
  }
  try {
    const auth = await getAuthorizedClient();
    const file = await uploadBuffer(auth, buffer, filename, mimeType);
    const driveLink = file.webViewLink || '';

    let content;
    if (kind === 'image') {
      content = await withTimeout(describeImage(buffer, mimeType || 'image/jpeg', noteText), 'Image analysis', 60_000);
    } else if (kind === 'document' && /pdf/i.test(mimeType || filename)) {
      content = (await withTimeout(extractPdfText(buffer, filename), 'PDF extraction', 100_000)) || filename;
    } else {
      content = noteText || filename;
    }
    if (noteText) content = `${content}\n\nNote: ${noteText}`;

    const saved = await storeItem(jid, kind, content, { sourceText: filename, driveLink });
    console.log(`🗂️  Stored #${saved.id} (${kind}): ${filename}`);
    await sendText(jid, `🗂️ Stored *${filename}* (#${saved.id}).${driveLink ? `\n${driveLink}` : ''}`);
  } catch (err) {
    console.error('Store media failed:', err);
    await sendText(jid, `⚠️ Couldn't store that (${err.message}).`);
  }
}

// Shared by both "media sent directly" and "reply-to-an-earlier-media" paths.
// Any save — whether triggered by "/store" or plain "save this" — now goes
// through storeMediaItem, so it's always searchable, not just archived.
async function handleImagePayload(jid, buffer, mimeType, text) {
  if (SAVE_INTENT.test(text)) {
    await storeMediaItem(jid, 'image', buffer, mimeType, defaultFilename('image', mimeType), stripStoreCommand(text));
  } else {
    const description = await withTimeout(
      describeImage(buffer, mimeType || 'image/jpeg', text),
      'Image analysis',
      60_000
    );
    await sendText(jid, description);
    console.log(`🤖 bot: ${description}`);
    pendingAttachments.set(jid, {
      kind: 'image',
      buffer,
      filename: defaultFilename('image', mimeType),
      mimeType,
      expiresAt: Date.now() + PENDING_TTL_MS,
    });
  }
}

async function handleFilePayload(jid, kind, buffer, mimeType, filename, text) {
  if (SAVE_INTENT.test(text)) {
    await storeMediaItem(jid, kind, buffer, mimeType, filename, stripStoreCommand(text));
  } else {
    pendingAttachments.set(jid, { kind, buffer, filename, mimeType, expiresAt: Date.now() + PENDING_TTL_MS });
    await sendText(jid, `📎 Got *${filename}*. Save this to Google Drive? (yes/no)`);
  }
}

function truncateForDisplay(s, n = 80) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * /store — saves whatever's referenced into the searchable knowledge base
 * (Neon + embeddings). Files also get uploaded to Drive; the link is stored
 * alongside their content (vision description / extracted PDF text).
 */
async function handleStoreCommand(jid, fullText, quoted, quotedInfo, msg, sock) {
  if (!isDbConfigured()) {
    await sendText(jid, "⚠️ Storage isn't configured yet. DATABASE_URL needs to be set first.");
    return;
  }

  const inlineText = stripStoreCommand(fullText);

  try {
    if (quoted) {
      const qImage = quoted.imageMessage;
      const qVideo = quoted.videoMessage;
      const qDoc = quoted.documentMessage;
      const qAudio = quoted.audioMessage;

      // A quoted voice note: transcribe it and store the transcript — far
      // more useful for search than the raw audio file would be.
      if (qAudio?.ptt) {
        const fakeMsg = {
          key: { remoteJid: jid, id: quotedInfo.stanzaId || msg.key.id, fromMe: false },
          message: quoted,
        };
        const buffer = await withTimeout(
          downloadMediaMessage(fakeMsg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage }),
          'Quoted voice note download'
        );
        const transcript = await withTimeout(
          transcribeAudio(buffer, 'voice.ogg', qAudio.mimetype || 'audio/ogg'),
          'Transcription'
        );
        let content = transcript;
        if (inlineText) content = `${content}\n\nNote: ${inlineText}`;
        const saved = await storeItem(jid, 'text', content, { sourceText: transcript });
        console.log(`🗂️  Stored #${saved.id} (voice transcript): ${truncateForDisplay(transcript)}`);
        await sendText(jid, `🗂️ Stored (#${saved.id}) from voice note: "${truncateForDisplay(transcript)}"`);
        return;
      }

      if (qImage || qVideo || qDoc || qAudio) {
        const qm = qImage || qDoc || qVideo || qAudio;
        const kind = qImage ? 'image' : qDoc ? 'document' : qVideo ? 'video' : 'audio';
        const fakeMsg = {
          key: { remoteJid: jid, id: quotedInfo.stanzaId || msg.key.id, fromMe: false },
          message: quoted,
        };
        const buffer = await withTimeout(
          downloadMediaMessage(fakeMsg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage }),
          `Quoted ${kind} download`
        );
        const filename = qDoc?.fileName || defaultFilename(kind, qm.mimetype);
        await storeMediaItem(jid, kind, buffer, qm.mimetype, filename, inlineText);
        return;
      }

      const quotedText = quoted.conversation || quoted.extendedTextMessage?.text || '';
      const textToStore = quotedText || inlineText;
      if (textToStore) {
        const { kind, content } = await withTimeout(prepareTextItem(textToStore), 'Link preview', 20_000);
        const saved = await storeItem(jid, kind, content, { sourceText: textToStore });
        console.log(`🗂️  Stored #${saved.id} (${kind}): ${truncateForDisplay(content)}`);
        await sendText(jid, `🗂️ Stored (#${saved.id}): "${truncateForDisplay(textToStore)}"`);
        return;
      }
    }

    if (inlineText) {
      const { kind, content } = await withTimeout(prepareTextItem(inlineText), 'Link preview', 20_000);
      const saved = await storeItem(jid, kind, content, { sourceText: inlineText });
      console.log(`🗂️  Stored #${saved.id} (${kind}): ${truncateForDisplay(content)}`);
      await sendText(jid, `🗂️ Stored (#${saved.id}): "${truncateForDisplay(inlineText)}"`);
      return;
    }

    await sendText(jid, '📝 Reply to a message with /store, or send `/store <text>` to save something.');
  } catch (err) {
    console.error('Store command failed:', err);
    await sendText(jid, `⚠️ Couldn't store that (${err.message}).`);
  }
}

const HELP = `🤖 *What I can do*

*To-do list*
• Tell me tasks naturally — "add buy milk", "mark 2 done", "remove 3"
• /list — show your list
• I ask every day at 10:00 what's on your plate

*Reminders*
• "remind me to study in 15 minutes"
• "remind me tomorrow to call mom" / "on 25th May..."
• "make sure I see it" → nudges again if unread after 5 min
• "what reminders do I have?" / "cancel reminder 2"
• Daily pings: 9:45 Keka login, 18:30 Keka logout (auto-nudges if unread)

*Files & photos*
• Send a photo → I describe it / answer questions about it
• Send a document/photo with "save this" → uploads to Google Drive
• Reply to an old photo/file and say "save this" → same, works later too
• "find that PDF about the lease" / "send me file X" → searches Drive
• /driveauth — connect your Google Drive (one-time setup)

*Save & recall anything (/store)*
• Reply to any text, link, photo, PDF, audio file, or voice note with /store → saved to a searchable archive (files also go to Drive; voice notes are saved as their transcript)
• Send a photo/file with /store as the caption → same, no reply needed
• /store <text> — save a note directly, no reply needed
• "what did I save about X?" — searches by meaning, not just keywords

*Voice notes*
• Send one and I'll transcribe it and reply — works for to-dos, reminders, anything

*Other*
• Ask anything needing current info — I can search the web
• /model — show or switch the AI model (e.g. /model gpt-4o)
• /newchat (or /reset) — start with a fresh conversation (to-dos/reminders/files are kept)
• /ping — health check
• Send a sticker — I'll 👍 back

Just chat naturally — you don't need to remember exact commands.`;

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
    case '/newchat':
      clearHistory(jid);
      await sendText(
        jid,
        cmd.toLowerCase() === '/newchat'
          ? "🆕 Started a new chat — I won't recall this conversation. (To-dos, reminders, Drive and /store items are all kept.)"
          : '🧹 Conversation memory cleared. (Your to-dos are kept.)'
      );
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

    case '/driveauth': {
      if (!isGoogleConfigured()) {
        await sendText(
          jid,
          "⚠️ Google Drive isn't configured yet. GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET need to be set first."
        );
        return true;
      }
      const redirectUri = `${config.publicUrl}/oauth2callback`;
      const url = getAuthUrl(redirectUri);
      const hint = config.publicUrl.includes('localhost')
        ? '⚠️ Open this link on the *same computer* running the bot (localhost won\'t work on your phone).'
        : 'Open this link on any device.';
      await sendText(jid, `🔗 *Connect Google Drive*\n${url}\n\n${hint}`);
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
  setSocket(sock);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      setCurrentQr(qr);
      console.log('\n📱 Scan this QR code in WhatsApp → Linked Devices:\n');
      console.log(`   Or open ${config.publicUrl}/qr in a browser for a crisp, scannable image.\n`);
      qrcode.generate(qr, { small: true });
      const qrPath = path.resolve('qr.png');
      QRImage.toFile(qrPath, qr, { width: 512, margin: 2 })
        .then(() => console.log(`🖼️  QR image saved to: ${qrPath}`))
        .catch((e) => console.error('Failed to write QR image:', e));
    }

    if (connection === 'open') {
      setCurrentQr(null);
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

  // Mark watched messages (see callWatch.js) as read so escalation.js won't
  // needlessly nudge the user for something they already saw.
  sock.ev.on('messages.update', (updates) => {
    for (const { key, update } of updates) {
      if (update.status >= 3 && key?.id) markRead(key.id);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      const candidates = [jid, msg.key.senderPn, msg.key.participantAlt].filter(Boolean);
      const digits = (s) => s.replace(/\D/g, '');
      const isAllowed = candidates.some((c) => digits(c) === config.allowedNumber);

      if (!isAllowed) continue;
      if (alreadyHandled(msg.key.id)) continue;
      setPrimaryJid(jid).catch(() => {});

      try {
        await sock.sendPresenceUpdate('composing', jid);

        const audio = msg.message.audioMessage;
        const image = msg.message.imageMessage;
        const video = msg.message.videoMessage;
        const document = msg.message.documentMessage;
        const sticker = msg.message.stickerMessage;

        // ---- Stickers: acknowledge, don't try to process them ----
        if (sticker) {
          console.log('🩹 Sticker received');
          await sendText(jid, '👍');
          continue;
        }

        // ---- Voice notes: transcribe, then treat like a typed message ----
        if (audio?.ptt) {
          try {
            const buffer = await withTimeout(
              downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage }),
              'Voice note download'
            );
            const transcript = await withTimeout(
              transcribeAudio(buffer, 'voice.ogg', audio.mimetype || 'audio/ogg'),
              'Transcription'
            );
            console.log(`🎙️ Transcribed: ${transcript}`);
            await sendText(jid, `🎙️ _"${transcript}"_`);

            const reply = await withTimeout(generateReply(jid, transcript), 'AI reply', 60_000);
            await sendText(jid, reply);
            console.log(`🤖 bot: ${reply}`);
          } catch (err) {
            console.error('Voice note handling failed:', err);
            await sendText(jid, `⚠️ Couldn't process that voice note (${err.message}).`);
          }
          continue;
        }

        // ---- Images: describe with vision, unless the caption asks to save ----
        if (image) {
          try {
            const buffer = await withTimeout(
              downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage }),
              'Image download'
            );
            const caption = (image.caption || '').trim();
            console.log(`🖼️  Image received${caption ? `: "${caption}"` : ''}`);
            await handleImagePayload(jid, buffer, image.mimetype, caption);
          } catch (err) {
            console.error('Image handling failed:', err);
            await sendText(jid, `⚠️ Couldn't process that image (${err.message}).`);
          }
          continue;
        }

        // ---- Documents / video / non-voice-note audio files: ask to save, or auto-save if caption says so ----
        if (document || video || audio) {
          try {
            const m = document || video || audio;
            const kind = document ? 'document' : video ? 'video' : 'audio';
            const buffer = await withTimeout(
              downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage }),
              `${kind} download`
            );
            const caption = (m.caption || '').trim();
            const filename = document?.fileName || defaultFilename(kind, m.mimetype);
            console.log(`📎 ${kind} received: ${filename}${caption ? ` ("${caption}")` : ''}`);
            await handleFilePayload(jid, kind, buffer, m.mimetype, filename, caption);
          } catch (err) {
            console.error('File handling failed:', err);
            await sendText(jid, `⚠️ Couldn't process that file (${err.message}).`);
          }
          continue;
        }

        // ---- Plain text ----
        const text = extractText(msg);
        if (!text) continue;

        console.log(`💬 ${config.allowedNumber}: ${text}`);

        const quotedInfo = msg.message.extendedTextMessage?.contextInfo;
        const quoted = quotedInfo?.quotedMessage;

        // ---- /store: save this message (or the one it replies to) for later semantic search ----
        // Matches anywhere in the message so "long note ... /store" tacked on at the end works too.
        if (/\/store\b/i.test(text)) {
          await handleStoreCommand(jid, text, quoted, quotedInfo, msg, sock);
          continue;
        }

        // ---- Replying to (quoting) an earlier photo/file: resolve it directly ----
        const quotedImage = quoted?.imageMessage;
        const quotedVideo = quoted?.videoMessage;
        const quotedDoc = quoted?.documentMessage;
        const quotedAudio = quoted?.audioMessage && !quoted.audioMessage.ptt ? quoted.audioMessage : null;
        if (quotedImage || quotedVideo || quotedDoc || quotedAudio) {
          try {
            const qm = quotedImage || quotedDoc || quotedVideo || quotedAudio;
            const kind = quotedImage ? 'image' : quotedDoc ? 'document' : quotedVideo ? 'video' : 'audio';
            const fakeMsg = {
              key: { remoteJid: jid, id: quotedInfo.stanzaId || msg.key.id, fromMe: false },
              message: quoted,
            };
            const buffer = await withTimeout(
              downloadMediaMessage(fakeMsg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage }),
              `Quoted ${kind} download`
            );
            console.log(`↩️  Reply references a ${kind}: "${text}"`);
            if (kind === 'image') {
              await handleImagePayload(jid, buffer, quotedImage.mimetype, text);
            } else {
              const filename = quotedDoc?.fileName || defaultFilename(kind, qm.mimetype);
              await handleFilePayload(jid, kind, buffer, qm.mimetype, filename, text);
            }
          } catch (err) {
            console.error('Quoted media handling failed:', err);
            await sendText(jid, `⚠️ Couldn't process that (${err.message}).`);
          }
          continue;
        }

        // A file is awaiting a yes/no answer for this chat.
        const pending = pendingAttachments.get(jid);
        if (pending) {
          pendingAttachments.delete(jid);
          if (Date.now() < pending.expiresAt) {
            if (YES_RE.test(text.trim())) {
              await storeMediaItem(jid, pending.kind, pending.buffer, pending.mimeType, pending.filename, '');
              continue;
            }
            if (NO_RE.test(text.trim())) {
              await sendText(jid, '👍 Not saved.');
              continue;
            }
          }
          // Anything else: drop the pending file and process this message normally.
        }

        if (text.startsWith('/')) {
          const handled = await handleCommand(jid, text);
          if (handled) continue;
        }

        const reply = await withTimeout(generateReply(jid, text), 'AI reply', 60_000);
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
