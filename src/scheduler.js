import cron from 'node-cron';
import { config } from './config.js';
import { getTodos, getPrimaryJid } from './store.js';
import { watchMessage } from './callWatch.js';

async function resolveJid() {
  // Prefer the chat JID we've actually seen messages arrive on (WhatsApp
  // may use a privacy @lid identity instead of the phone-number JID).
  return (await getPrimaryJid()) || config.allowedJid;
}

function scheduleJob(cronExpr, label, task) {
  if (!cron.validate(cronExpr)) {
    console.error(`❌ Invalid cron expression for ${label}: "${cronExpr}" — not scheduled.`);
    return;
  }
  cron.schedule(cronExpr, task, { timezone: config.timezone });
  console.log(`⏰ ${label} scheduled: "${cronExpr}" (${config.timezone})`);
}

/**
 * Schedules recurring daily messages: the morning to-do prompt and an
 * optional evening reminder (e.g. "log out of Keka").
 * @param {(jid: string, text: string) => Promise<any>} sendText
 */
export function startScheduler(sendText) {
  scheduleJob(config.dailyCron, 'Daily to-do prompt', async () => {
    const jid = await resolveJid();
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
  });

  for (const { cron: cronExpr, message, escalate } of config.dailyReminders) {
    scheduleJob(cronExpr, `Daily reminder ("${message}")`, async () => {
      const jid = await resolveJid();
      try {
        const sent = await sendText(jid, message);
        if (escalate) watchMessage(sent?.key?.id, jid, message);
        console.log(`⏰ Sent daily reminder: ${message}`);
      } catch (err) {
        console.error('Failed to send daily reminder:', err);
      }
    });
  }
}
