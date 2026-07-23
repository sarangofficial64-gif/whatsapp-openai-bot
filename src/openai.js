import OpenAI from 'openai';
import { config } from './config.js';
import {
  getModel,
  getTodos,
  addTodo,
  completeTodo,
  removeTodo,
  clearTodos,
  addReminder,
  getReminders,
  cancelReminder,
} from './store.js';
import { getAuthorizedClient } from './google.js';
import { searchFiles, downloadFileById } from './drive.js';
import { sendDocument } from './wa-actions.js';
import { webSearch } from './websearch.js';
import { searchKnowledge, storeItem, prepareTextItem, isDbConfigured } from './knowledge.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });

// Simple in-memory conversation store: { jid -> [{role, content}, ...] }
const histories = new Map();

function getHistory(jid) {
  if (!histories.has(jid)) histories.set(jid, []);
  return histories.get(jid);
}

export function clearHistory(jid) {
  histories.delete(jid);
}

// ---- Tools the model can call to manage the to-do list ----

const tools = [
  {
    type: 'function',
    function: {
      name: 'add_todo',
      description: "Add a task to the user's to-do list.",
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The task to add' } },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_todos',
      description: "Get the user's current to-do list with task numbers and status.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_todo',
      description: 'Mark a task as done by its number.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'integer', description: 'The task number' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_todo',
      description: 'Delete a task from the list by its number.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'integer', description: 'The task number' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clear_todos',
      description: 'Clear tasks. scope "completed" removes only done tasks; "all" wipes the list.',
      parameters: {
        type: 'object',
        properties: { scope: { type: 'string', enum: ['all', 'completed'] } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_reminder',
      description:
        'Set a one-time reminder that messages the user at a future time. For relative requests ' +
        '("in 15 minutes", "in an hour") use minutes. For anything tied to a date/time ("tomorrow", ' +
        '"on 25th May", "at 6pm") compute when_iso yourself as an ISO 8601 datetime with timezone ' +
        'offset, using the current date/time given in your instructions as the reference point.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'What to remind the user about' },
          minutes: { type: 'number', description: 'Delay in minutes from now (for relative requests)' },
          when_iso: {
            type: 'string',
            description: 'Absolute due time as ISO 8601 with offset, e.g. "2026-05-25T09:00:00+05:30" (for date/time requests)',
          },
          escalate: {
            type: 'boolean',
            description: 'If true, send a more insistent follow-up nudge if the user has not read the reminder within 5 minutes. Only set this when the user asks to be really made sure they notice.',
          },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_reminders',
      description: "List the user's upcoming (not yet sent) reminders.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_reminder',
      description: 'Cancel a pending reminder by its ID.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'integer' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the live web for current information — news, prices, facts you are unsure of, anything after your training cutoff.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The search query' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'store_note',
      description:
        'Save a piece of text to the searchable archive when the user asks you to remember, note down, or ' +
        'save something in conversation (not via the explicit /store command, which is handled separately). ' +
        'Only call this if you actually have text to save — never claim something was saved without calling it.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The text to save' } },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description:
        "Semantically search things the user saved with /store (notes, links, saved images/PDFs) " +
        'by meaning, not just keywords — e.g. "what did I save about the lease?"',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_drive_files',
      description:
        "Search files the bot previously saved to the user's Google Drive, by name. Empty query lists recent files.",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Text to search for in file names' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_drive_file',
      description: 'Send a Google Drive file to the user in this chat. Get the fileId from search_drive_files first.',
      parameters: {
        type: 'object',
        properties: { fileId: { type: 'string' } },
        required: ['fileId'],
      },
    },
  },
];

async function execTool(jid, name, args) {
  switch (name) {
    case 'add_todo': {
      const todo = await addTodo(jid, args.text);
      return { ok: true, added: todo };
    }
    case 'list_todos':
      return { todos: await getTodos(jid) };
    case 'complete_todo': {
      const todo = await completeTodo(jid, args.id);
      return todo ? { ok: true, completed: todo } : { ok: false, error: 'No task with that number' };
    }
    case 'remove_todo': {
      const todo = await removeTodo(jid, args.id);
      return todo ? { ok: true, removed: todo } : { ok: false, error: 'No task with that number' };
    }
    case 'clear_todos':
      await clearTodos(jid, args.scope || 'all');
      return { ok: true };
    case 'create_reminder': {
      let dueAt;
      if (args.when_iso) {
        const d = new Date(args.when_iso);
        if (isNaN(d.getTime())) return { ok: false, error: 'when_iso is not a valid ISO datetime' };
        dueAt = d.toISOString();
      } else if (args.minutes) {
        const minutes = Number(args.minutes);
        if (!minutes || minutes <= 0) return { ok: false, error: 'minutes must be a positive number' };
        dueAt = new Date(Date.now() + minutes * 60_000).toISOString();
      } else {
        return { ok: false, error: 'Provide either minutes or when_iso' };
      }
      const reminder = await addReminder(jid, args.text, dueAt, Boolean(args.escalate));
      return { ok: true, reminder: { id: reminder.id, text: reminder.text, due: formatDueDate(reminder.dueAt) } };
    }
    case 'list_reminders': {
      const reminders = (await getReminders(jid)).filter((r) => !r.fired);
      return { reminders: reminders.map((r) => ({ id: r.id, text: r.text, due: formatDueDate(r.dueAt) })) };
    }
    case 'cancel_reminder': {
      const removed = await cancelReminder(jid, args.id);
      return removed ? { ok: true, cancelled: removed } : { ok: false, error: 'No pending reminder with that ID' };
    }
    case 'web_search': {
      try {
        const result = await webSearch(args.query);
        return { result };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
    case 'store_note': {
      if (!isDbConfigured()) return { ok: false, error: "Storage isn't configured yet." };
      try {
        const { kind, content } = await prepareTextItem(args.text);
        const saved = await storeItem(jid, kind, content, { sourceText: args.text });
        return { ok: true, saved: { id: saved.id, content: saved.content } };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
    case 'search_knowledge': {
      if (!isDbConfigured()) return { ok: false, error: "Storage isn't configured yet." };
      try {
        const results = await searchKnowledge(jid, args.query);
        return {
          results: results.map((r) => ({
            id: r.id,
            kind: r.kind,
            content: r.content.slice(0, 500),
            driveLink: r.drive_link,
            similarity: r.similarity,
          })),
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
    case 'search_drive_files': {
      try {
        const auth = await getAuthorizedClient();
        const files = await searchFiles(auth, args.query || '');
        return { files: files.map((f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime })) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
    case 'send_drive_file': {
      try {
        const auth = await getAuthorizedClient();
        const { buffer, name, mimeType } = await downloadFileById(auth, args.fileId);
        await sendDocument(jid, buffer, name, mimeType);
        return { ok: true, sent: name };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
    default:
      return { ok: false, error: `Unknown tool ${name}` };
  }
}

/**
 * Formats a UTC ISO timestamp in the bot's local timezone. Reminders are
 * always converted here, server-side — the model was unreliable at doing
 * this arithmetic itself when reading times back (it correctly reasons
 * about "2pm" when creating a reminder, but garbles the UTC offset when
 * asked to relay a stored UTC timestamp back as local time).
 */
function formatDueDate(isoString) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(isoString));
}

function currentDateTime() {
  const readable = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date());

  const offsetPart = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName');
  const offset = (offsetPart?.value || 'GMT+00:00').replace('GMT', '');

  return `${readable} (UTC offset ${offset})`;
}

function systemPrompt() {
  return (
    `${config.systemPrompt}\n\n` +
    `Current date/time (${config.timezone}): ${currentDateTime()}. Use this as the reference ` +
    'point for anything relative like "today", "tomorrow", or a specific date.\n\n' +
    'You also manage the user\'s daily to-do list. When the user mentions ' +
    'something they need to do, add it with add_todo. When they ask what\'s on ' +
    'their list, call list_todos and summarize it. Mark tasks done or remove ' +
    'them when asked. Always refer to tasks by their number. Keep confirmations short.\n\n' +
    'You can set one-time reminders with create_reminder — use minutes for relative ' +
    'requests ("in 15 minutes"), or compute when_iso (ISO 8601 with timezone offset) ' +
    'for date/time requests ("tomorrow", "on 25th May", "at 6pm") using the current ' +
    'date/time above as the reference point. Use list_reminders / cancel_reminder when asked about existing ones.\n\n' +
    'You can also find and send back files the bot has saved to the user\'s ' +
    'Google Drive: use search_drive_files to look one up by name, then ' +
    'send_drive_file with its ID to deliver it in this chat.\n\n' +
    'Use web_search whenever the user asks something needing current information ' +
    '(news, prices, live facts) or anything you are not confident about from memory.\n\n' +
    'The user saves notes, links, images and PDFs with /store (handled outside of you). ' +
    'ALWAYS call search_knowledge before answering ANY question that could be about something ' +
    'the user told you, saved, or discussed before — including casual phrasing like "what do we ' +
    'know about X", "do you remember X", "who/what is X". Do this even if X sounds like it could ' +
    'be a public figure or well-known thing — for this user, a name is far more likely to refer ' +
    'to their own notes than to someone famous. Only fall back to general knowledge or web_search ' +
    'if search_knowledge returns nothing relevant. If a past reply in this conversation turns out ' +
    'to have been wrong, say so plainly rather than building on the mistake.\n\n' +
    'If they ask you in conversation to remember/note down/save something (without the /store ' +
    'command), use store_note.\n\n' +
    'Never say you saved, uploaded, stored, or remembered something unless you actually called ' +
    'a tool that did it and it returned ok. If you can\'t actually perform an action, say so ' +
    'instead of pretending you did it.'
  );
}

/**
 * Generate an AI reply, running any to-do tool calls the model requests.
 */
export async function generateReply(jid, userText) {
  const history = getHistory(jid);
  history.push({ role: 'user', content: userText });

  const model = await getModel();
  const messages = [
    { role: 'system', content: systemPrompt() },
    ...history.slice(-config.historyLimit),
  ];

  // Allow a few tool-call rounds before producing the final text.
  for (let round = 0; round < 5; round++) {
    const completion = await client.chat.completions.create({ model, messages, tools });
    const msg = completion.choices[0].message;
    messages.push(msg);

    if (msg.tool_calls?.length) {
      for (const call of msg.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          /* ignore malformed args */
        }
        const result = await execTool(jid, call.function.name, args);
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
      continue; // let the model react to tool results
    }

    const reply = msg.content?.trim() || 'Done.';
    history.push({ role: 'assistant', content: reply });
    return reply;
  }

  return "I got a bit tangled up handling that — mind rephrasing?";
}
