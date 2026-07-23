/**
 * Tracks messages that should get a follow-up nudge if they go unread.
 * In-memory only — the window is a few minutes, so losing this on a
 * restart is an acceptable tradeoff for keeping it simple.
 */

const watches = new Map(); // messageId -> { jid, label, sentAt, read }

export function watchMessage(id, jid, label) {
  if (!id) return;
  watches.set(id, { jid, label, sentAt: Date.now(), read: false });
}

export function markRead(id) {
  const w = watches.get(id);
  if (w) w.read = true;
}

/**
 * Returns watches that are still unread past windowMs (without removing
 * them — the caller should call clearWatch() once it has actually sent the
 * nudge, so a failed send gets retried on the next check instead of lost).
 * Already-read watches are cleaned up here since nothing more will happen to them.
 */
export function takeOverdue(windowMs) {
  const now = Date.now();
  const overdue = [];
  for (const [id, w] of watches) {
    if (now - w.sentAt < windowMs) continue;
    if (!w.read) overdue.push({ id, ...w });
    else watches.delete(id);
  }
  return overdue;
}

export function clearWatch(id) {
  watches.delete(id);
}
