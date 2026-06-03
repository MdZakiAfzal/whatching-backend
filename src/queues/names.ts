export const QUEUE_NAMES = {
  whatsappWebhookProcess: 'whatsapp_webhook-process',
  whatsappWebhookDlq: 'whatsapp_webhook-dlq',
  templateSendProcess: 'messages_template-send',
  textReplyProcess: 'messages_text-reply',
  agentReplyProcess: 'messages_agent-reply',
  broadcastFanoutProcess: 'broadcasts_fanout',
  integrationHealthSyncProcess: 'integration_health-sync',
  knowledgeIngestProcess: 'bot_knowledge-ingest',
  conversationTimeoutProcess: 'bot_conversation-timeout',
} as const;
