import { connectDB } from './loaders/database';
import { startWhatsAppWebhookWorker } from './workers/whatsappWebhookWorker';
import { startTemplateSendWorker } from './workers/templateSendWorker'; // NEW

const bootstrapWorker = async () => {
  await connectDB();

  const whatsappWorker = startWhatsAppWebhookWorker();
  const templateWorker = startTemplateSendWorker(); // NEW

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

  // --- Graceful Shutdown ---
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down workers gracefully...`);
    
    // Safely close both workers concurrently before exiting
    await Promise.all([
      whatsappWorker.close(),
      templateWorker.close()
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