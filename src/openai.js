import OpenAI from 'openai';
import { config } from './config.js';
import {
  getModel,
  getTodos,
  addTodo,
  completeTodo,
  removeTodo,
  clearTodos,
} from './store.js';

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
    default:
      return { ok: false, error: `Unknown tool ${name}` };
  }
}

function systemPrompt() {
  return (
    `${config.systemPrompt}\n\n` +
    'You also manage the user\'s daily to-do list. When the user mentions ' +
    'something they need to do, add it with add_todo. When they ask what\'s on ' +
    'their list, call list_todos and summarize it. Mark tasks done or remove ' +
    'them when asked. Always refer to tasks by their number. Keep confirmations short.'
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
