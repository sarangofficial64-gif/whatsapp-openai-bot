import { promises as fs } from 'fs';
import path from 'path';
import { config } from './config.js';

/**
 * Tiny JSON-file persistence for todos and runtime settings.
 * Shape: { todos: { [jid]: Todo[] }, settings: { model } }
 * Stored at DATA_DIR/data.json (put DATA_DIR on the Railway volume).
 */

const FILE = path.join(config.dataDir, 'data.json');

let data = { todos: {}, settings: {}, reminders: [] };
let loaded = false;
let loadPromise = null;

async function ensureLoaded() {
  if (loaded) return;
  // Cache the in-flight load so concurrent callers (e.g. a message handler
  // and a cron tick landing at the same instant on a cold start) await the
  // same read instead of each racing to overwrite `data`.
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const raw = await fs.readFile(FILE, 'utf8');
        const parsed = JSON.parse(raw);
        data = {
          todos: parsed.todos || {},
          settings: parsed.settings || {},
          reminders: parsed.reminders || [],
        };
      } catch {
        data = { todos: {}, settings: {}, reminders: [] };
      }
      loaded = true;
    })();
  }
  return loadPromise;
}

async function persist() {
  await fs.mkdir(config.dataDir, { recursive: true });
  const tmp = `${FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, FILE); // atomic-ish write to avoid corruption
}

function listFor(jid) {
  if (!data.todos[jid]) data.todos[jid] = [];
  return data.todos[jid];
}

// ---- Todos ----

export async function getTodos(jid) {
  await ensureLoaded();
  return listFor(jid);
}

export async function addTodo(jid, text) {
  await ensureLoaded();
  const list = listFor(jid);
  const id = list.reduce((max, t) => Math.max(max, t.id), 0) + 1;
  const todo = { id, text: String(text).trim(), done: false, createdAt: new Date().toISOString() };
  list.push(todo);
  await persist();
  return todo;
}

export async function completeTodo(jid, id) {
  await ensureLoaded();
  const todo = listFor(jid).find((t) => t.id === Number(id));
  if (!todo) return null;
  todo.done = true;
  await persist();
  return todo;
}

export async function removeTodo(jid, id) {
  await ensureLoaded();
  const list = listFor(jid);
  const idx = list.findIndex((t) => t.id === Number(id));
  if (idx === -1) return null;
  const [removed] = list.splice(idx, 1);
  await persist();
  return removed;
}

export async function clearTodos(jid, scope = 'all') {
  await ensureLoaded();
  const list = listFor(jid);
  if (scope === 'completed') {
    data.todos[jid] = list.filter((t) => !t.done);
  } else {
    data.todos[jid] = [];
  }
  await persist();
  return true;
}

/** Human-readable rendering of a todo list. */
export function formatTodos(todos) {
  if (!todos || todos.length === 0) return '📭 Your to-do list is empty.';
  const lines = todos.map((t) => `${t.done ? '✅' : '⬜'} ${t.id}. ${t.text}`);
  const pending = todos.filter((t) => !t.done).length;
  return `📋 *Your to-dos* (${pending} pending)\n${lines.join('\n')}`;
}

// ---- Settings ----

export async function getModel() {
  await ensureLoaded();
  return data.settings.model || config.openaiModel;
}

export async function setModel(model) {
  await ensureLoaded();
  data.settings.model = model;
  await persist();
  return model;
}

// ---- Reminders ----

function reminderList() {
  if (!data.reminders) data.reminders = [];
  return data.reminders;
}

export async function addReminder(jid, text, dueAt, escalate = false) {
  await ensureLoaded();
  const list = reminderList();

  // Guard against duplicate creation (e.g. the model issuing two tool calls
  // for the same reminder in one turn) — same chat, same text, same due
  // time, not yet fired: treat as the same reminder rather than adding another.
  const normalizedText = String(text).trim().toLowerCase();
  const existing = list.find(
    (r) => r.jid === jid && !r.fired && r.dueAt === dueAt && r.text.trim().toLowerCase() === normalizedText
  );
  if (existing) return existing;

  const id = list.reduce((max, r) => Math.max(max, r.id), 0) + 1;
  const reminder = {
    id,
    jid,
    text: String(text).trim(),
    dueAt,
    escalate: Boolean(escalate),
    fired: false,
    createdAt: new Date().toISOString(),
  };
  list.push(reminder);
  await persist();
  return reminder;
}

export async function getReminders(jid) {
  await ensureLoaded();
  return reminderList().filter((r) => r.jid === jid);
}

export async function getDueReminders(nowIso) {
  await ensureLoaded();
  return reminderList().filter((r) => !r.fired && r.dueAt <= nowIso);
}

export async function markReminderFired(id) {
  await ensureLoaded();
  const r = reminderList().find((r) => r.id === id);
  if (r) {
    r.fired = true;
    await persist();
  }
  return r;
}

export async function cancelReminder(jid, id) {
  await ensureLoaded();
  const list = reminderList();
  const idx = list.findIndex((r) => r.id === Number(id) && r.jid === jid && !r.fired);
  if (idx === -1) return null;
  const [removed] = list.splice(idx, 1);
  await persist();
  return removed;
}

// ---- Primary chat JID ----
// WhatsApp may address the allowed chat by a privacy @lid identity rather
// than the phone-number JID. We remember whichever one actually delivers
// messages so the scheduler (and anything else outside a live message
// handler) can reach the same chat todos are stored under.

export async function getPrimaryJid() {
  await ensureLoaded();
  return data.settings.primaryJid || null;
}

export async function setPrimaryJid(jid) {
  await ensureLoaded();
  if (data.settings.primaryJid === jid) return;
  data.settings.primaryJid = jid;
  await persist();
}

// ---- Google Drive auth ----

export async function getGoogleRefreshToken() {
  await ensureLoaded();
  return data.settings.googleRefreshToken || null;
}

export async function setGoogleRefreshToken(token) {
  await ensureLoaded();
  data.settings.googleRefreshToken = token;
  await persist();
}
