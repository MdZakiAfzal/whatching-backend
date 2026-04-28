export interface PlanDetails {
  maxSubscribers: number;
  maxAgents: number;
  maxAiTokens: number;
  features: {
    bulkMessaging: boolean;
    aiAgent: boolean;
    chatbotBuilder: boolean;
    instagramIntegration: boolean;
    formBuilder: boolean;
    whiteLabel: boolean; // "Remove Powered by Whatching"
  };
}

export const PLANS: Record<string, PlanDetails> = {
  none: {
    maxSubscribers: 0,
    maxAgents:0, 
    maxAiTokens: 0,
    features: {
      bulkMessaging: false,
      aiAgent: false,
      chatbotBuilder: false,
      instagramIntegration: false,
      formBuilder: false,
      whiteLabel: false,
    },
  },
  basic: {
    maxSubscribers: 5000,
    maxAgents: 2, // From your screenshot: "2 Team Members"
    maxAiTokens: 100000,
    features: {
      bulkMessaging: true,
      aiAgent: true,
      chatbotBuilder: true,
      instagramIntegration: false,
      formBuilder: false,
      whiteLabel: false,
    },
  },
  pro: {
    maxSubscribers: 15000,
    maxAgents: 5, // From your screenshot: "5 Team Members"
    maxAiTokens: Infinity, // Unlimited
    features: {
      bulkMessaging: true,
      aiAgent: true,
      chatbotBuilder: true,
      instagramIntegration: true,
      formBuilder: true,
      whiteLabel: true,
    },
  },
  enterprise: {
    maxSubscribers: 1000000,
    maxAgents: 999,
    maxAiTokens: Infinity,
    features: {
      bulkMessaging: true,
      aiAgent: true,
      chatbotBuilder: true,
      instagramIntegration: true,
      formBuilder: true,
      whiteLabel: true,
    },
  },
};