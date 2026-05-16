import { connectDB } from './loaders/database';
import { startWhatsAppWebhookWorker } from './workers/whatsappWebhookWorker';
import { startTemplateSendWorker } from './workers/templateSendWorker'; // NEW
import { startTextReplyWorker } from './workers/textReplyWorker';
import { startBroadcastFanoutWorker } from './workers/broadcastFanoutWorker';

const bootstrapWorker = async () => {
  await connectDB();

  const whatsappWorker = startWhatsAppWebhookWorker();
  const templateWorker = startTemplateSendWorker(); // NEW
  const textReplyWorker = startTextReplyWorker();
  const broadcastWorker = startBroadcastFanoutWorker();

  // --- WhatsApp Webhook Worker Events ---
  whatsappWorker.on('ready', () => {
    console.log('👷 WhatsApp webhook worker is ready');
  });

  whatsappWorker.on('failed', (job, error) => {
    console.error(
      `🛑 WhatsApp webhook job failed: jobId=${job?.id ?? 'unknown'} error=${error.message}`
    );
  });

  // --- Template Send Worker Events (NEW) ---
  templateWorker.on('ready', () => {
    console.log('👷 Template Send worker is ready');
  });

  templateWorker.on('failed', (job, error) => {
    console.error(
      `🛑 Template Send job failed: jobId=${job?.id ?? 'unknown'} error=${error.message}`
    );
  });

  textReplyWorker.on('ready', () => {
    console.log('👷 Text Reply worker is ready');
  });

  textReplyWorker.on('failed', (job, error) => {
    console.error(
      `🛑 Text Reply job failed: jobId=${job?.id ?? 'unknown'} error=${error.message}`
    );
  });

  broadcastWorker.on('ready', () => {
    console.log('👷 Broadcast Fanout worker is ready');
  });

  broadcastWorker.on('failed', (job, error) => {
    console.error(
      `🛑 Broadcast Fanout job failed: jobId=${job?.id ?? 'unknown'} error=${error.message}`
    );
  });

  // --- Graceful Shutdown ---
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down workers gracefully...`);
    
    // Safely close both workers concurrently before exiting
    await Promise.all([
      whatsappWorker.close(),
      templateWorker.close(),
      textReplyWorker.close(),
      broadcastWorker.close(),
    ]);
    
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
};

void bootstrapWorker();
