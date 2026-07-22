import OpenAI from 'openai';
import { config } from './config.js';
import { getModel } from './store.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });

/** Ask the model about an image (caption is the user's question, if any). */
export async function describeImage(buffer, mimeType, caption) {
  const model = await getModel();
  const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`;

  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: caption?.trim() || 'Describe this image concisely.' },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() || "I couldn't make sense of that image.";
}
