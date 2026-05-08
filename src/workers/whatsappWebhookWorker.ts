import { Job, Worker } from 'bullmq';
import WebhookEvent from '../models/WebhookEvent';
import Message from '../models/Message';
import { upsertSubscriber } from '../services/subscriberService';
import { getOrCreateActiveConversation } from '../services/conversationService';
import { QUEUE_NAMES } from '../queues/names';
import { WhatsAppWebhookJobData } from '../queues/whatsappWebhookQueue';
import { createWorkerConnection } from '../queues/redis';

const markWebhookProcessed = async (webhookEventId: string) => {
  await WebhookEvent.findByIdAndUpdate(webhookEventId, {
    processingStatus: 'processed',
    processedAt: new Date(),
    $inc: { processingAttempts: 1 },
    $unset: { error: 1 },
  });
};

const markWebhookFailed = async (webhookEventId: string, error: unknown) => {
  await WebhookEvent.findByIdAndUpdate(webhookEventId, {
    processingStatus: 'failed',
    $inc: { processingAttempts: 1 },
    error: error instanceof Error ? error.message : 'Unknown worker error',
  });
};

const processWhatsAppWebhookJob = async (job: Job<WhatsAppWebhookJobData>) => {
  const webhookEvent = await WebhookEvent.findById(job.data.webhookEventId);
  if (!webhookEvent || webhookEvent.processingStatus === 'processed') return;

  await WebhookEvent.findByIdAndUpdate(webhookEvent._id, { processingStatus: 'processing' });

  try {
    const payload = webhookEvent.payload;

    if (payload?.object === 'whatsapp_business_account' && webhookEvent.orgId) {
      const value = payload.entry?.[0]?.changes?.[0]?.value;

      // --- INBOUND MESSAGE HANDLING ---
      if (value?.messages && value.messages.length > 0) {
        const message = value.messages[0];
        const contact = value.contacts?.[0]; // Meta sends the profile name here
        const phoneNumber = message.from;
        const profileName = contact?.profile?.name;

        // 1. Get or Create Subscriber
        const subscriber = await upsertSubscriber(webhookEvent.orgId, phoneNumber, profileName);

        // 2. Extract Text
        let messageText = '';
        if (message.type === 'text') {
          messageText = message.text.body;
        } else {
          messageText = `[Received ${message.type} message]`; // Fallback for images/audio
        }

        // 3. Get or Create Thread
        const conversation = await getOrCreateActiveConversation(
          webhookEvent.orgId, 
          subscriber._id as any, 
          messageText
        );

        // 4. Save the actual message to DB
        await Message.create({
          orgId: webhookEvent.orgId,
          conversationId: (conversation as any)._id,
          subscriberId: subscriber._id,
          direction: 'inbound',
          type: message.type === 'text' ? 'text' : 'unknown',
          metaMessageId: message.id,
          status: 'received',
          payload: { text: messageText },
          // Meta timestamps are in seconds, JS needs milliseconds
          sentAt: new Date(parseInt(message.timestamp) * 1000) 
        });

        console.log(`✅ INBOX: Message from ${profileName || phoneNumber}: "${messageText}"`);
      }
      
      // TODO: Handle delivery status updates (read/delivered) here in the future
    }

    await markWebhookProcessed(String(webhookEvent._id));
  } catch (error) {
    await markWebhookFailed(String(webhookEvent._id), error);
    throw error;
  }
};

export const startWhatsAppWebhookWorker = () =>
  new Worker<WhatsAppWebhookJobData>(
    QUEUE_NAMES.whatsappWebhookProcess,
    processWhatsAppWebhookJob,
    {
      connection: createWorkerConnection('whatching-whatsapp-worker'),
      concurrency: 5,
    }
  );
