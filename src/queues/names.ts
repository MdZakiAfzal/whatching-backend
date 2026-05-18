export const QUEUE_NAMES = {
  whatsappWebhookProcess: 'whatsapp_webhook-process',
  templateSendProcess: 'messages_template-send',
  textReplyProcess: 'messages_text-reply',
  agentReplyProcess: 'messages_agent-reply',
  broadcastFanoutProcess: 'broadcasts_fanout',
  integrationHealthSyncProcess: 'integration_health-sync',
} as const;
