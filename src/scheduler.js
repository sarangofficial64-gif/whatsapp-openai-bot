import cron from 'node-cron';
import { config } from './config.js';
import { getTodos } from './store.js';

/**
 * Schedules the daily "what's your to-do?" prompt.
 * @param {(jid: string, text: string) => Promise<any>} sendText
 */
export function startScheduler(sendText) {
  if (!cron.validate(config.dailyCron)) {
    console.error(`❌ Invalid DAILY_CRON: "${config.dailyCron}" — scheduler not started.`);
    return;
  }

  cron.schedule(
    config.dailyCron,
    async () => {
      const jid = config.allowedJid;
      try {
        const todos = await getTodos(jid);
        const pending = todos.filter((t) => !t.done);

        let msg =
          "🌞 Good morning! What's on your to-do list for today?\n" +
          "Just tell me your tasks and I'll keep track. Ask me to *show my list* anytime.";

        if (pending.length) {
          const lines = pending.map((t) => `⬜ ${t.id}. ${t.text}`).join('\n');
          msg += `\n\n*Still pending from before:*\n${lines}`;
        }

        await sendText(jid, msg);
        console.log('⏰ Sent daily to-do prompt.');
      } catch (err) {
        console.error('Failed to send daily prompt:', err);
      }
    },
    { timezone: config.timezone }
  );

  console.log(`⏰ Daily to-do prompt scheduled: "${config.dailyCron}" (${config.timezone})`);
}
