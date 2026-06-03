import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import BotSettings from '../models/BotSettings';
import BotFlow from '../models/BotFlow';
import KnowledgeSource from '../models/KnowledgeSource';
import KnowledgeChunk from '../models/KnowledgeChunk';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';
import { config } from '../config';
import { deleteFromCloudinary, uploadBufferToCloudinary } from '../services/cloudinaryService';
import { enqueueKnowledgeIngestJob } from '../queues/knowledgeIngestQueue';
import { getBotReadiness, getOrCreateBotSettings } from '../services/botOrchestrator';
import { getAiTokenUsageState } from '../services/usageService';
import {
  ensureRequiredBotFlows,
  isRequiredBotTriggerKey,
  REQUIRED_BOT_TRIGGER_KEYS,
} from '../services/botDefaultFlowService';
import BotCanvas from '../models/BotCanvas';
import {
  ensureDefaultBotCanvas,
  findPublishedNodeByTriggerKey,
  getActiveCanvas,
  publishCanvasDraft,
  updateCanvasDraft,
  validateCanvasDraft,
} from '../services/botCanvasService';

const validateFlowContent = (blockType: string, content: Record<string, unknown>) => {
  if (blockType === 'text' && typeof content.text !== 'string') {
    throw new AppError('Text bot blocks require a text value.', 400);
  }

  if (blockType === 'buttons' && typeof content.bodyText !== 'string') {
    throw new AppError('Button bot blocks require bodyText.', 400);
  }

  if (blockType === 'buttons' && content.mediaType) {
    const mediaType = String(content.mediaType).toLowerCase();
    if (!['image', 'document', 'video'].includes(mediaType)) {
      throw new AppError('Button mediaType must be image, document, or video.', 400);
    }
    if (typeof content.mediaId !== 'string' || !/^[a-f\d]{24}$/i.test(content.mediaId.trim())) {
      throw new AppError('Button media headers require a valid mediaId when mediaType is provided.', 400);
    }
  }

  if (blockType === 'list') {
    if (typeof content.bodyText !== 'string' || typeof content.buttonText !== 'string') {
      throw new AppError('List bot blocks require bodyText and buttonText.', 400);
    }

    if (!Array.isArray(content.sections) || content.sections.length === 0) {
      throw new AppError('List bot blocks require at least one section.', 400);
    }
  }

  if (
    (blockType === 'image' || blockType === 'document' || blockType === 'video') &&
    (typeof content.mediaId !== 'string' || !/^[a-f\d]{24}$/i.test(content.mediaId.trim()))
  ) {
    throw new AppError(`${blockType} bot blocks require a valid mediaId.`, 400);
  }

  if (blockType === 'location') {
    if (
      typeof content.latitude !== 'number' ||
      typeof content.longitude !== 'number'
    ) {
      throw new AppError('Location bot blocks require latitude and longitude.', 400);
    }
  }

  if (blockType === 'product_carousel') {
    if (typeof content.catalogId !== 'string' || !Array.isArray(content.sections) || content.sections.length === 0) {
      throw new AppError('Product carousel bot blocks require catalogId and sections.', 400);
    }
  }

  if (blockType === 'generic_carousel') {
    if (!Array.isArray(content.cards) || content.cards.length === 0) {
      throw new AppError('Generic carousel blocks require at least one card.', 400);
    }

    for (const [index, card] of content.cards.entries()) {
      if (!card || typeof card !== 'object') {
        throw new AppError(`Carousel card ${index + 1} is invalid.`, 400);
      }

      const typedCard = card as Record<string, unknown>;
      if (typeof typedCard.bodyText !== 'string' || typedCard.bodyText.trim().length === 0) {
        throw new AppError(`Carousel card ${index + 1} requires bodyText.`, 400);
      }

      if (typedCard.mediaType) {
        const mediaType = String(typedCard.mediaType).toLowerCase();
        if (!['image', 'video'].includes(mediaType)) {
          throw new AppError(`Carousel card ${index + 1} mediaType must be image or video.`, 400);
        }
        if (typeof typedCard.mediaId !== 'string' || !/^[a-f\d]{24}$/i.test(typedCard.mediaId.trim())) {
          throw new AppError(`Carousel card ${index + 1} requires a valid mediaId when mediaType is provided.`, 400);
        }
      }

      const buttons = typedCard.buttons;
      if (!Array.isArray(buttons) || buttons.length === 0) {
        throw new AppError(`Carousel card ${index + 1} requires at least one reply button.`, 400);
      }
    }
  }
};

const normalizeCanvasFlows = (rawBody: any) => {
  const flows = Array.isArray(rawBody) ? rawBody : rawBody?.flows;
  if (!Array.isArray(flows) || flows.length === 0) {
    throw new AppError('Canvas publish requires a non-empty flows array.', 400);
  }
  return flows;
};

const ensureDefaultFlowExists = async (orgId: string, defaultTriggerKey: string) => {
  const defaultFlow = await BotFlow.findOne({
    orgId,
    triggerKey: defaultTriggerKey,
    status: 'published',
  }).select('_id');

  if (!defaultFlow) {
    throw new AppError(
      `A published ${defaultTriggerKey} flow is required before enabling the bot.`,
      400
    );
  }
};

export const getBotSettings = catchAsync(async (req: any, res: Response) => {
  await ensureDefaultBotCanvas({
    orgId: req.org._id,
    userId: req.user._id,
  });
  const settings = await getOrCreateBotSettings(String(req.org._id), String(req.user._id));

  res.status(200).json({
    status: 'success',
    data: { settings },
  });
});

export const updateBotSettings = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const allowedSettingsPatch = {
    ...(typeof req.body.isBotEnabled === 'boolean' ? { isBotEnabled: req.body.isBotEnabled } : {}),
    ...(typeof req.body.isAiEnabled === 'boolean' ? { isAiEnabled: req.body.isAiEnabled } : {}),
    ...(Array.isArray(req.body.greetingKeywords) ? { greetingKeywords: req.body.greetingKeywords } : {}),
    ...(Array.isArray(req.body.optOutKeywords) ? { optOutKeywords: req.body.optOutKeywords } : {}),
    ...(Array.isArray(req.body.escalationTriggerIds)
      ? { escalationTriggerIds: req.body.escalationTriggerIds }
      : {}),
  };
  const existing = await getOrCreateBotSettings(String(req.org._id), String(req.user._id));
  const nextSettings = {
    ...existing.toObject(),
    ...allowedSettingsPatch,
  };

  if (nextSettings.isBotEnabled) {
    await ensureDefaultBotCanvas({
      orgId: req.org._id,
      userId: req.user._id,
    });
    const canvas = await getActiveCanvas(req.org._id);
    const defaultNode = findPublishedNodeByTriggerKey(
      canvas,
      nextSettings.defaultTriggerKey || 'DEFAULT'
    );
    if (!defaultNode) {
      return next(
        new AppError(
          `A published ${nextSettings.defaultTriggerKey || 'DEFAULT'} canvas node is required before enabling the bot.`,
          400
        )
      );
    }
  }

  if (nextSettings.isAiEnabled && !config.gemini.apiKey) {
    return next(new AppError('Gemini API key is not configured for AI fallback.', 400));
  }

  const settings = await BotSettings.findOneAndUpdate(
    { orgId: req.org._id },
    {
      $set: {
        ...allowedSettingsPatch,
        updatedBy: req.user._id,
      },
    },
    {
      upsert: true,
      returnDocument: 'after',
      runValidators: true,
    }
  );

  res.status(200).json({
    status: 'success',
    data: { settings },
  });
});

export const getBotCanvasDraft = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  await ensureDefaultBotCanvas({
    orgId: req.org._id,
    userId: req.user._id,
  });
  const canvas = await BotCanvas.findOne({
    orgId: req.org._id,
    status: 'active',
  }).select('_id orgId name status draftState updatedAt');

  if (!canvas) {
    return next(new AppError('Bot canvas not found for this organization.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      canvasId: canvas._id,
      draftState: canvas.draftState,
      updatedAt: canvas.updatedAt,
    },
  });
});

export const saveBotCanvasDraft = catchAsync(async (req: any, res: Response) => {
  const draftState = req.body.draftState || req.body;
  const canvas = await updateCanvasDraft({
    orgId: req.org._id,
    draftState,
    userId: req.user._id,
  });

  res.status(200).json({
    status: 'success',
    data: {
      canvasId: canvas._id,
      draftState: canvas.draftState,
      updatedAt: canvas.updatedAt,
    },
  });
});

export const validateBotCanvas = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  await ensureDefaultBotCanvas({
    orgId: req.org._id,
    userId: req.user._id,
  });
  const canvas = await BotCanvas.findOne({
    orgId: req.org._id,
    status: 'active',
  }).select('draftState');

  if (!canvas) {
    return next(new AppError('Active bot canvas not found for this organization.', 404));
  }

  const validation = await validateCanvasDraft({
    draftState: canvas.draftState,
    orgId: req.org._id,
  });
  res.status(200).json({
    status: 'success',
    data: { validation },
  });
});

export const publishBotCanvasDraft = catchAsync(async (req: any, res: Response) => {
  const body = req.body || {};
  const hasInlineDraft = Object.keys(body).length > 0;
  const result = await publishCanvasDraft({
    orgId: req.org._id,
    userId: req.user._id,
    draftState: hasInlineDraft ? body.draftState || body : undefined,
  });

  res.status(200).json({
    status: 'success',
    data: result,
  });
});

export const getBotCanvasPublished = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  await ensureDefaultBotCanvas({
    orgId: req.org._id,
    userId: req.user._id,
  });
  const canvas = await BotCanvas.findOne({
    orgId: req.org._id,
    status: 'active',
  }).select('_id orgId name status publishedState updatedAt');

  if (!canvas) {
    return next(new AppError('Bot canvas not found for this organization.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      canvasId: canvas._id,
      publishedState: canvas.publishedState || null,
      updatedAt: canvas.updatedAt,
    },
  });
});

export const listBotFlows = catchAsync(async (req: any, res: Response) => {
  await ensureRequiredBotFlows({
    orgId: req.org._id,
    userId: req.user._id,
  });
  const filter: Record<string, unknown> = { orgId: req.org._id };

  if (typeof req.query.status === 'string' && ['draft', 'published', 'archived'].includes(req.query.status)) {
    filter.status = req.query.status;
  }

  const flows = await BotFlow.find(filter).sort({
    status: 1,
    sortOrder: 1,
    updatedAt: -1,
  });

  res.status(200).json({
    status: 'success',
    results: flows.length,
    data: { flows },
  });
});

export const createBotFlow = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  validateFlowContent(req.body.blockType, req.body.content);

  const flow = await BotFlow.create({
    orgId: req.org._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
    ...req.body,
    triggerKey: String(req.body.triggerKey).trim().toUpperCase(),
  });

  res.status(201).json({
    status: 'success',
    data: { flow },
  });
});

export const getBotFlow = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const flow = await BotFlow.findOne({
    _id: req.params.flowId,
    orgId: req.org._id,
  });

  if (!flow) {
    return next(new AppError('Bot flow not found for this organization.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { flow },
  });
});

export const updateBotFlow = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const flow = await BotFlow.findOne({
    _id: req.params.flowId,
    orgId: req.org._id,
  });

  if (!flow) {
    return next(new AppError('Bot flow not found for this organization.', 404));
  }

  if (flow.status === 'archived') {
    return next(new AppError('Archived bot flows cannot be edited.', 400));
  }

  if (
    isRequiredBotTriggerKey(flow.triggerKey) &&
    req.body.triggerKey &&
    String(req.body.triggerKey).trim().toUpperCase() !== flow.triggerKey
  ) {
    return next(new AppError(`${flow.triggerKey} is a required system flow. Its triggerKey cannot be changed.`, 400));
  }

  const blockType = req.body.blockType || flow.blockType;
  const content = req.body.content || flow.content;
  validateFlowContent(blockType, content);

  Object.assign(flow, {
    ...req.body,
    updatedBy: req.user._id,
    ...(req.body.triggerKey ? { triggerKey: String(req.body.triggerKey).trim().toUpperCase() } : {}),
  });
  flow.version += 1;
  await flow.save();

  res.status(200).json({
    status: 'success',
    data: { flow },
  });
});

export const publishBotFlow = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const flow = await BotFlow.findOne({
    _id: req.params.flowId,
    orgId: req.org._id,
  });

  if (!flow) {
    return next(new AppError('Bot flow not found for this organization.', 404));
  }

  validateFlowContent(flow.blockType, flow.content);

  flow.status = 'published';
  flow.publishedAt = new Date();
  flow.archivedAt = undefined;
  flow.updatedBy = req.user._id;
  await flow.save();

  res.status(200).json({
    status: 'success',
    data: { flow },
  });
});

export const archiveBotFlow = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const flow = await BotFlow.findOne({
    _id: req.params.flowId,
    orgId: req.org._id,
  });

  if (!flow) {
    return next(new AppError('Bot flow not found for this organization.', 404));
  }

  if (isRequiredBotTriggerKey(flow.triggerKey)) {
    return next(new AppError(`${flow.triggerKey} is a required system flow and cannot be archived.`, 400));
  }

  flow.status = 'archived';
  flow.archivedAt = new Date();
  flow.updatedBy = req.user._id;
  await flow.save();

  res.status(200).json({
    status: 'success',
    data: { flow },
  });
});

export const publishBotCanvas = catchAsync(async (req: any, res: Response) => {
  const incomingFlows = normalizeCanvasFlows(req.body);
  const orgId = String(req.org._id);
  const userId = req.user._id;

  for (const flow of incomingFlows) {
    validateFlowContent(flow.blockType, flow.content || {});
  }

  const normalizedFlows = incomingFlows.map((flow: any, index: number) => ({
    orgId: req.org._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
    status: 'published' as const,
    publishedAt: new Date(),
    archivedAt: undefined,
    name: String(flow.name || '').trim(),
    triggerKey: String(flow.triggerKey || '').trim().toUpperCase(),
    blockType: flow.blockType,
    sortOrder:
      Number.isFinite(flow.sortOrder) && Number(flow.sortOrder) >= 0
        ? Number(flow.sortOrder)
        : index,
    version: Number.isFinite(flow.version) && Number(flow.version) > 0 ? Number(flow.version) : 1,
    content: flow.content || {},
    actions: Array.isArray(flow.actions) ? flow.actions : [],
  }));

  const uniqueTriggerKeys = new Set(normalizedFlows.map((flow) => flow.triggerKey));
  if (uniqueTriggerKeys.size !== normalizedFlows.length) {
    throw new AppError('Canvas contains duplicate triggerKey values.', 409);
  }

  if (!uniqueTriggerKeys.has(REQUIRED_BOT_TRIGGER_KEYS.default)) {
    throw new AppError('Canvas must include a DEFAULT root trigger block.', 400);
  }

  if (!uniqueTriggerKeys.has(REQUIRED_BOT_TRIGGER_KEYS.optOut)) {
    throw new AppError('Canvas must include an OPT_OUT compliance trigger block.', 400);
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await BotFlow.updateMany(
        {
          orgId: req.org._id,
          status: { $in: ['draft', 'published'] },
        },
        {
          $set: {
            status: 'archived',
            archivedAt: new Date(),
            updatedBy: userId,
          },
        },
        { session }
      );

      await BotFlow.insertMany(normalizedFlows, { session, ordered: true });
    });
  } finally {
    await session.endSession();
  }

  const publishedFlows = await BotFlow.find({
    orgId,
    status: 'published',
  }).sort({ sortOrder: 1, updatedAt: -1 });

  res.status(200).json({
    status: 'success',
    data: {
      publishedAt: new Date().toISOString(),
      results: publishedFlows.length,
      flows: publishedFlows,
    },
  });
});

export const listKnowledgeSources = catchAsync(async (req: any, res: Response) => {
  const sources = await KnowledgeSource.find({
    orgId: req.org._id,
  }).sort({ createdAt: -1 });

  res.status(200).json({
    status: 'success',
    results: sources.length,
    data: { sources },
  });
});

export const createKnowledgeTextSource = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  if (req.body.type === 'faq' && (!Array.isArray(req.body.faqEntries) || req.body.faqEntries.length === 0)) {
    return next(new AppError('FAQ knowledge sources require faqEntries.', 400));
  }

  if (req.body.type === 'text' && typeof req.body.content !== 'string') {
    return next(new AppError('Text knowledge sources require content.', 400));
  }

  const source = await KnowledgeSource.create({
    orgId: req.org._id,
    createdBy: req.user._id,
    type: req.body.type,
    title: req.body.title,
    content: req.body.content,
    faqEntries: req.body.faqEntries,
    status: 'pending',
  });

  await enqueueKnowledgeIngestJob({
    orgId: String(req.org._id),
    sourceId: String(source._id),
    initiatedBy: String(req.user._id),
    traceId: `knowledge_${String(req.org._id)}_${String(source._id)}`,
    createdAt: new Date().toISOString(),
  });

  res.status(201).json({
    status: 'success',
    data: { source },
  });
});

export const uploadKnowledgeSource = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const file = req.file as Express.Multer.File | undefined;
  if (!file) {
    return next(new AppError('Please upload a TXT, PDF, or DOCX knowledge file.', 400));
  }

  const allowedMimeTypes = new Set([
    'text/plain',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]);

  if (!allowedMimeTypes.has(file.mimetype)) {
    return next(new AppError('Only TXT, PDF, and DOCX files are supported for the knowledge base.', 400));
  }

  const uploadResult = await uploadBufferToCloudinary({
    buffer: file.buffer,
    folder: `${config.cloudinary.folder}/knowledge/${String(req.org._id)}`,
    filename: file.originalname,
    resourceType: 'raw',
    mimeType: file.mimetype,
    tags: ['whatching', 'knowledge'],
  });

  const source = await KnowledgeSource.create({
    orgId: req.org._id,
    createdBy: req.user._id,
    type: 'file',
    title: typeof req.body.title === 'string' && req.body.title.trim().length > 0
      ? req.body.title.trim()
      : file.originalname,
    filename: file.originalname,
    mimeType: file.mimetype,
    cloudinaryUrl: uploadResult.secure_url,
    publicId: uploadResult.public_id,
    status: 'pending',
  });

  await enqueueKnowledgeIngestJob({
    orgId: String(req.org._id),
    sourceId: String(source._id),
    initiatedBy: String(req.user._id),
    traceId: `knowledge_${String(req.org._id)}_${String(source._id)}`,
    createdAt: new Date().toISOString(),
  });

  res.status(201).json({
    status: 'success',
    data: { source },
  });
});

export const deleteKnowledgeSource = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const source = await KnowledgeSource.findOne({
    _id: req.params.sourceId,
    orgId: req.org._id,
  });

  if (!source) {
    return next(new AppError('Knowledge source not found for this organization.', 404));
  }

  if (source.publicId) {
    try {
      await deleteFromCloudinary({ publicId: source.publicId, resourceType: 'raw' });
    } catch (error) {
      console.warn(`Failed to delete knowledge asset ${source.publicId} from Cloudinary.`);
    }
  }

  await Promise.all([
    KnowledgeChunk.deleteMany({ orgId: req.org._id, sourceId: source._id }),
    source.deleteOne(),
  ]);

  res.status(200).json({
    status: 'success',
    message: 'Knowledge source deleted successfully.',
  });
});

export const reingestKnowledgeSource = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const source = await KnowledgeSource.findOne({
    _id: req.params.sourceId,
    orgId: req.org._id,
  });

  if (!source) {
    return next(new AppError('Knowledge source not found for this organization.', 404));
  }

  source.status = 'pending';
  source.ingestError = undefined;
  await source.save();

  await enqueueKnowledgeIngestJob({
    orgId: String(req.org._id),
    sourceId: String(source._id),
    initiatedBy: String(req.user._id),
    traceId: `knowledge_reingest_${String(req.org._id)}_${String(source._id)}`,
    createdAt: new Date().toISOString(),
  });

  res.status(202).json({
    status: 'success',
    message: 'Knowledge source queued for re-ingestion.',
    data: { source },
  });
});

export const getBotStatus = catchAsync(async (req: any, res: Response) => {
  const [readiness, aiUsage, knowledgeSummary] = await Promise.all([
    getBotReadiness(String(req.org._id)),
    getAiTokenUsageState(req.org._id),
    KnowledgeSource.aggregate([
      { $match: { orgId: req.org._id } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      botEnabled: readiness.settings?.isBotEnabled || false,
      aiEnabled: readiness.settings?.isAiEnabled || false,
      defaultFlowReady: readiness.defaultFlowReady,
      optOutFlowReady: readiness.optOutFlowReady,
      publishedFlowCount: readiness.publishedFlowCount,
      aiUsage,
      cycleResetAt: aiUsage?.cycleResetsAt || null,
      geminiConfigured: Boolean(config.gemini.apiKey),
      knowledgeSummary,
    },
  });
});
