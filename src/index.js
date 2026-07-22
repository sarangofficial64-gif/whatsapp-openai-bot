import { startBot, sendText } from './whatsapp.js';
import { startScheduler } from './scheduler.js';

console.log('🚀 Starting WhatsApp OpenAI bot...');

startBot()
  .then(() => {
    // Schedule the daily to-do prompt once; it uses the live socket at fire time.
    startScheduler(sendText);
  })
  .catch((err) => {
    console.error('Fatal error starting bot:', err);
    process.exit(1);
  });

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
