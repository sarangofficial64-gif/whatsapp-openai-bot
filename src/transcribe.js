import OpenAI from 'openai';
import { config } from './config.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });

/** Transcribe a voice note buffer to text using OpenAI's Whisper model. */
export async function transcribeAudio(buffer, filename = 'voice.ogg', mimeType = 'audio/ogg') {
  const file = new File([buffer], filename, { type: mimeType });
  const res = await client.audio.transcriptions.create({
    file,
    model: config.transcribeModel,
  });
  return res.text.trim();
}
