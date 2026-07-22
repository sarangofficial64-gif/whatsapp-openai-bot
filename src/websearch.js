import OpenAI from 'openai';
import { config } from './config.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });

// The hosted web_search tool is only available via the Responses API, so a
// search request is delegated to a one-off Responses API call — the bot's
// main conversation loop keeps using Chat Completions with its own tools.
const WEB_SEARCH_MODEL = process.env.WEB_SEARCH_MODEL || 'gpt-4o-mini';

export async function webSearch(query) {
  const response = await client.responses.create({
    model: WEB_SEARCH_MODEL,
    tools: [{ type: 'web_search_preview' }],
    input: query,
  });
  return response.output_text?.trim() || "I couldn't find anything useful.";
}
