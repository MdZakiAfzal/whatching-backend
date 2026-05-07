import { connectDB } from './loaders/database';
import { startWhatsAppWebhookWorker } from './workers/whatsappWebhookWorker';

const bootstrapWorker = async () => {
  await connectDB();

  const whatsappWorker = startWhatsAppWebhookWorker();

  whatsappWorker.on('ready', () => {
    console.log('👷 WhatsApp webhook worker is ready');
  });

  whatsappWorker.on('failed', (job, error) => {
    console.error(
      `🛑 WhatsApp webhook job failed: jobId=${job?.id ?? 'unknown'} error=${error.message}`
    );
  });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down worker gracefully...`);
    await whatsappWorker.close();
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
