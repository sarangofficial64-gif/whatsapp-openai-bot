import { takeOverdue, clearWatch } from './callWatch.js';

const CHECK_INTERVAL_MS = 20_000;
const UNREAD_WINDOW_MS = 5 * 60 * 1000;

/** Nudges the user with a follow-up message if a watched reminder went unread. */
export function startEscalationChecker(sendText) {
  setInterval(async () => {
    const overdue = takeOverdue(UNREAD_WINDOW_MS);
    for (const w of overdue) {
      try {
        await sendText(w.jid, `⏰🔴 *Still haven't seen this?* ${w.label}`);
        clearWatch(w.id);
        console.log(`🔔 Escalated unread reminder: ${w.label}`);
      } catch (err) {
        console.error('Escalation send failed, will retry next check:', err);
      }
    }
  }, CHECK_INTERVAL_MS);

  console.log(`🔔 Escalation checker running (nudges unread after ${UNREAD_WINDOW_MS / 60000}m)`);
}
