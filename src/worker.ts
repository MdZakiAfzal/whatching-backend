import { connectDB } from './loaders/database';
import { startWhatsAppWebhookWorker } from './workers/whatsappWebhookWorker';
import { startTemplateSendWorker } from './workers/templateSendWorker'; // NEW
import { startAgentReplyWorker } from './workers/agentReplyWorker';
import { startBroadcastFanoutWorker } from './workers/broadcastFanoutWorker';
import { startIntegrationHealthWorker } from './workers/integrationHealthWorker';
import { registerDailyIntegrationHealthScan } from './queues/integrationHealthQueue';

const bootstrapWorker = async () => {
  await connectDB();
  await registerDailyIntegrationHealthScan();

  const whatsappWorker = startWhatsAppWebhookWorker();
  const templateWorker = startTemplateSendWorker(); // NEW
  const agentReplyWorker = startAgentReplyWorker();
  const broadcastWorker = startBroadcastFanoutWorker();
  const integrationHealthWorker = startIntegrationHealthWorker();

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

  agentReplyWorker.on('ready', () => {
    console.log('👷 Agent Reply worker is ready');
  });

  agentReplyWorker.on('failed', (job, error) => {
    console.error(
      `🛑 Agent Reply job failed: jobId=${job?.id ?? 'unknown'} error=${error.message}`
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

  integrationHealthWorker.on('ready', () => {
    console.log('👷 Integration Health worker is ready');
  });

  integrationHealthWorker.on('failed', (job, error) => {
    console.error(
      `🛑 Integration Health job failed: jobId=${job?.id ?? 'unknown'} error=${error.message}`
    );
  });

  // --- Graceful Shutdown ---
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down workers gracefully...`);
    
    // Safely close both workers concurrently before exiting
    await Promise.all([
      whatsappWorker.close(),
      templateWorker.close(),
      agentReplyWorker.close(),
      broadcastWorker.close(),
      integrationHealthWorker.close(),
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
