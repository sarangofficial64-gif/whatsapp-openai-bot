import { promises as fs } from 'fs';
import path from 'path';
import { config } from './config.js';

/**
 * Tiny JSON-file persistence for todos and runtime settings.
 * Shape: { todos: { [jid]: Todo[] }, settings: { model } }
 * Stored at DATA_DIR/data.json (put DATA_DIR on the Railway volume).
 */

const FILE = path.join(config.dataDir, 'data.json');

let data = { todos: {}, settings: {} };
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    data = { todos: parsed.todos || {}, settings: parsed.settings || {} };
  } catch {
    data = { todos: {}, settings: {} };
  }
  loaded = true;
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
