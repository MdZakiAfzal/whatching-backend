import { connectDB } from './loaders/database';
import { startWhatsAppWebhookWorker } from './workers/whatsappWebhookWorker';
import { startTemplateSendWorker } from './workers/templateSendWorker';
import { startAgentReplyWorker } from './workers/agentReplyWorker';
import { startBroadcastFanoutWorker } from './workers/broadcastFanoutWorker';
import { startIntegrationHealthWorker } from './workers/integrationHealthWorker';
import { registerDailyIntegrationHealthScan } from './queues/integrationHealthQueue';
import { startKnowledgeIngestWorker } from './workers/knowledgeIngestWorker';
import { startConversationTimeoutWorker } from './workers/conversationTimeoutWorker';

const bootstrapWorker = async () => {
  await connectDB();
  await registerDailyIntegrationHealthScan();

  const whatsappWorker = startWhatsAppWebhookWorker();
  const templateWorker = startTemplateSendWorker();
  const agentReplyWorker = startAgentReplyWorker();
  const broadcastWorker = startBroadcastFanoutWorker();
  const integrationHealthWorker = startIntegrationHealthWorker();
  const knowledgeIngestWorker = startKnowledgeIngestWorker();
  const conversationTimeoutWorker = startConversationTimeoutWorker();

  whatsappWorker.on('ready', () => {
    console.log('👷 WhatsApp webhook worker is ready');
  });
  whatsappWorker.on('failed', (job, error) => {
    console.error(
      `🛑 WhatsApp webhook job failed: jobId=${job?.id ?? 'unknown'} error=${error.message}`
    );
  });

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

  knowledgeIngestWorker.on('ready', () => {
    console.log('👷 Knowledge Ingest worker is ready');
  });
  knowledgeIngestWorker.on('failed', (job, error) => {
    console.error(
      `🛑 Knowledge Ingest job failed: jobId=${job?.id ?? 'unknown'} error=${error.message}`
    );
  });

  conversationTimeoutWorker.on('ready', () => {
    console.log('👷 Conversation Timeout worker is ready');
  });
  conversationTimeoutWorker.on('failed', (job, error) => {
    console.error(
      `🛑 Conversation Timeout job failed: jobId=${job?.id ?? 'unknown'} error=${error.message}`
    );
  });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down workers gracefully...`);

    await Promise.all([
      whatsappWorker.close(),
      templateWorker.close(),
      agentReplyWorker.close(),
      broadcastWorker.close(),
      integrationHealthWorker.close(),
      knowledgeIngestWorker.close(),
      conversationTimeoutWorker.close(),
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
