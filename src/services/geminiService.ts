import axios from 'axios';
import { config } from '../config';

export type GeminiBotResult = {
  replyText: string;
  routeTriggerKey: string | null;
  needsHuman: boolean;
  reason: string;
  totalTokens: number;
};

const responseJsonSchema = {
  type: 'object',
  properties: {
    replyText: { type: 'string' },
    routeTriggerKey: { type: ['string', 'null'] },
    needsHuman: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['replyText', 'routeTriggerKey', 'needsHuman', 'reason'],
};

export const generateBotAiResponse = async ({
  systemPrompt,
  businessName,
  subscriberName,
  question,
  knowledgeChunks,
  allowedTriggerKeys,
  model,
}: {
  systemPrompt: string;
  businessName: string;
  subscriberName?: string;
  question: string;
  knowledgeChunks: Array<{ content: string }>;
  allowedTriggerKeys: string[];
  model?: string;
}): Promise<GeminiBotResult> => {
  if (!config.gemini.apiKey) {
    throw new Error('Gemini API key is not configured.');
  }

  const kbContext = knowledgeChunks.length
    ? knowledgeChunks.map((chunk, index) => `Chunk ${index + 1}:\n${chunk.content}`).join('\n\n')
    : 'No knowledge base context was found.';

  const prompt = [
    `Business: ${businessName}`,
    subscriberName ? `Customer name: ${subscriberName}` : null,
    `Allowed route trigger keys: ${allowedTriggerKeys.join(', ') || 'NONE'}`,
    'If a route trigger key would help, return exactly one key from the allowlist. Otherwise return null.',
    'If the question clearly needs human support, set needsHuman=true.',
    `Knowledge base context:\n${kbContext}`,
    `Customer question:\n${question}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model || config.gemini.model}:generateContent`,
    {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema,
      },
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.gemini.apiKey,
      },
    }
  );

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini did not return structured text output.');
  }

  const parsed = JSON.parse(text);
  const normalizedRoute =
    typeof parsed.routeTriggerKey === 'string' && allowedTriggerKeys.includes(parsed.routeTriggerKey.trim().toUpperCase())
      ? parsed.routeTriggerKey.trim().toUpperCase()
      : null;

  return {
    replyText: String(parsed.replyText || '').trim(),
    routeTriggerKey: normalizedRoute,
    needsHuman: Boolean(parsed.needsHuman),
    reason: String(parsed.reason || '').trim(),
    totalTokens: Number(response.data?.usageMetadata?.totalTokenCount || 0),
  };
};
