import { Response, NextFunction } from 'express';
import { PlanManager } from '../utils/planManager';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';

export const checkAiLimit = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const plan = new PlanManager(req.org);

  // 1. Feature Check: Is the AI Agent enabled for this plan?
  if (!plan.canUse('aiAgent')) {
    return next(new AppError('AI Agent features are not included in your current plan.', 403));
  }

  // 2. Usage Check: Has the monthly AI token limit been reached?
  const isAllowed = plan.isUnderLimit('aiTokens', req.org.usage.aiTokensUsed);
  if (!isAllowed) {
    return next(new AppError('Monthly AI token limit reached. Please upgrade your plan to continue.', 402));
  }

  next();
});