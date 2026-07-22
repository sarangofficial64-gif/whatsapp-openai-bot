import { startBot } from './whatsapp.js';
import { sendText } from './wa-actions.js';
import { startScheduler } from './scheduler.js';
import { startReminderChecker } from './reminders.js';
import { startEscalationChecker } from './escalation.js';
import { startServer } from './server.js';

console.log('🚀 Starting WhatsApp OpenAI bot...');

startServer();

startBot()
  .then(() => {
    startScheduler(sendText);
    startReminderChecker(sendText);
    startEscalationChecker(sendText);
  })
  .catch((err) => {
    console.error('Fatal error starting bot:', err);
    process.exit(1);
  });

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
