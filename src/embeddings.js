import OpenAI from 'openai';
import { config } from './config.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });

/** Returns a 1536-dim embedding vector for the given text. */
export async function embed(text) {
  const res = await client.embeddings.create({
    model: config.embeddingModel,
    input: text.slice(0, 8000), // keep well under the model's token limit
  });
  return res.data[0].embedding;
}
