import { getDueReminders, markReminderFired } from './store.js';
import { watchMessage } from './callWatch.js';

const CHECK_INTERVAL_MS = 20_000;

/**
 * Polls for due reminders and sends them. Polling (rather than one setTimeout
 * per reminder) means reminders still fire correctly after a restart, even
 * if they came due while the bot was offline.
 */
export function startReminderChecker(sendText) {
  setInterval(async () => {
    try {
      const due = await getDueReminders(new Date().toISOString());
      for (const r of due) {
        try {
          const sent = await sendText(r.jid, `⏰ Reminder: ${r.text}`);
          // Only mark fired after a successful send — if this throws (e.g.
          // WhatsApp mid-reconnect), the reminder stays due and gets retried
          // on the next poll instead of being silently lost.
          await markReminderFired(r.id);
          if (r.escalate) watchMessage(sent?.key?.id, r.jid, r.text);
          console.log(`⏰ Fired reminder #${r.id}: ${r.text}`);
        } catch (err) {
          console.error(`Failed to send reminder #${r.id}, will retry next check:`, err);
        }
      }
    } catch (err) {
      console.error('Reminder check failed:', err);
    }
  }, CHECK_INTERVAL_MS);

  console.log(`⏰ Reminder checker running (every ${CHECK_INTERVAL_MS / 1000}s)`);
}
