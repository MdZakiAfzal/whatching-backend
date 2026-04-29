import { PLANS, PlanDetails } from '../config/planConfig';
import { IOrganization } from '../models/Organization';

export class PlanManager {
  private config: PlanDetails;

  constructor(org: IOrganization) {
    this.config = PLANS[org.planTier] || PLANS.none;
  }

  /**
   * Check if a boolean feature is enabled for the current plan
   */
  canUse(feature: keyof PlanDetails['features']): boolean {
    return this.config.features[feature];
  }

  /**
   * Professional check for numerical limits (Subscribers or Agent Seats)
   */
  isUnderLimit(type: 'subscribers' | 'agents' | 'aiTokens', currentCount: number): boolean {
    const limitMap = {
      subscribers: this.config.maxSubscribers,
      agents: this.config.maxAgents,
      aiTokens: this.config.maxAiTokens, // FIX: Added AI Token limit support
    };
    
    return currentCount < limitMap[type];
  }
}