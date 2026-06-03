import mongoose from 'mongoose';
import BotCanvas, {
  IBotCanvas,
  IBotCanvasCompiledAction,
  IBotCanvasEdge,
  IBotCanvasNode,
  IBotCanvasPublishedState,
} from '../models/BotCanvas';
import BotSettings from '../models/BotSettings';
import { BotFlowBlockType, IBotFlowAction } from '../models/BotFlow';
import Media from '../models/Media';
import AppError from '../utils/AppError';
import { buildMetaPayloadFromFlow, normalizeTriggerKey } from './botFlowService';
import {
  DEFAULT_OPT_OUT_KEYWORDS,
  REQUIRED_BOT_TRIGGER_KEYS,
} from './botDefaultFlowService';
import { createRedisPubSubConnection } from '../queues/redis';

const LIVE_CANVAS_CACHE_TTL_SECONDS = 60 * 60;
const canvasCacheRedis = createRedisPubSubConnection('whatching-bot-canvas-cache');

const buildPublishedCanvasCacheKey = (orgId: string | mongoose.Types.ObjectId) =>
  `bot_canvas:published:${String(orgId)}`;

const BLOCK_TYPES = new Set<BotFlowBlockType>([
  'text',
  'buttons',
  'list',
  'image',
  'document',
  'video',
  'location',
  'product_carousel',
  'generic_carousel',
]);

const objectIdPattern = /^[a-f\d]{24}$/i;

export const normalizeCanvasNodeId = (value: unknown, fallback: string) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
};

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const asFiniteNumber = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const getNodeData = (rawNode: Record<string, unknown>) => ({
  ...asObject(rawNode.data),
  ...rawNode,
});

const normalizeAction = (rawAction: unknown, index: number): IBotFlowAction => {
  const action = asObject(rawAction);
  const type = asString(action.type) || 'go_to_trigger';

  return {
    actionId: asString(action.actionId) || `action_${index + 1}`,
    type: type as IBotFlowAction['type'],
    label: asString(action.label) || undefined,
    replyId: asString(action.replyId) || undefined,
    nextTriggerKey: action.nextTriggerKey
      ? normalizeTriggerKey(String(action.nextTriggerKey))
      : undefined,
    url: asString(action.url) || undefined,
    metadata: asObject(action.metadata),
  };
};

const deriveActionsFromContent = (
  blockType: BotFlowBlockType,
  content: Record<string, unknown>,
  offset: number
) => {
  const derived: IBotFlowAction[] = [];
  const addReplyAction = (replyId: unknown, label: unknown) => {
    const normalizedReplyId = asString(replyId);
    if (!normalizedReplyId) {
      return;
    }

    derived.push({
      actionId: `content_action_${offset + derived.length + 1}`,
      type: 'go_to_trigger',
      replyId: normalizedReplyId,
      label: asString(label) || normalizedReplyId,
      metadata: {},
    });
  };

  if (blockType === 'buttons' && Array.isArray(content.buttons)) {
    content.buttons.forEach((button) => {
      const typedButton = asObject(button);
      addReplyAction(typedButton.replyId || typedButton.id, typedButton.label || typedButton.title);
    });
  }

  if (blockType === 'list' && Array.isArray(content.sections)) {
    content.sections.forEach((section) => {
      const typedSection = asObject(section);
      if (Array.isArray(typedSection.rows)) {
        typedSection.rows.forEach((row) => {
          const typedRow = asObject(row);
          addReplyAction(typedRow.replyId || typedRow.id, typedRow.label || typedRow.title);
        });
      }
    });
  }

  if (blockType === 'generic_carousel' && Array.isArray(content.cards)) {
    content.cards.forEach((card) => {
      const typedCard = asObject(card);
      if (Array.isArray(typedCard.buttons)) {
        typedCard.buttons.forEach((button) => {
          const typedButton = asObject(button);
          const buttonType = asString(typedButton.type) || (typedButton.url ? 'url' : 'quick_reply');
          if (buttonType !== 'url') {
            addReplyAction(typedButton.replyId || typedButton.id, typedButton.label || typedButton.title);
          }
        });
      }
    });
  }

  return derived;
};

const normalizeNode = (rawNode: unknown, index: number): IBotCanvasNode => {
  const node = asObject(rawNode);
  const data = getNodeData(node);
  const blockType = asString(data.blockType || data.type || node.type) as BotFlowBlockType;
  const triggerKey = normalizeTriggerKey(
    asString(data.triggerKey) || asString(data.keyword) || `NODE_${index + 1}`
  );
  const position = asObject(node.position || data.position);
  const content = asObject(data.content);
  const explicitActions = Array.isArray(data.actions)
    ? data.actions.map((action, actionIndex) => normalizeAction(action, actionIndex))
    : [];
  const contentActions = deriveActionsFromContent(blockType, content, explicitActions.length);
  for (const explicitAction of explicitActions) {
    const matchingContentAction = contentActions.find(
      (contentAction) => contentAction.replyId && contentAction.replyId === explicitAction.replyId
    );
    if (matchingContentAction?.label && !explicitAction.label) {
      explicitAction.label = matchingContentAction.label;
    }
  }
  const actionIds = new Set(explicitActions.map((action) => action.actionId));
  const replyIds = new Set(explicitActions.map((action) => action.replyId).filter(Boolean));
  const derivedActions = contentActions.filter((action) => {
    if (actionIds.has(action.actionId) || (action.replyId && replyIds.has(action.replyId))) {
      return false;
    }
    if (action.replyId) {
      replyIds.add(action.replyId);
    }
    actionIds.add(action.actionId);
    return true;
  });
  const actions = [...explicitActions, ...derivedActions];

  return {
    id: normalizeCanvasNodeId(node.id || data.id, triggerKey),
    triggerKey,
    name: asString(data.name || data.label || data.title) || triggerKey,
    blockType,
    sortOrder: Number.isInteger(data.sortOrder) ? Number(data.sortOrder) : index,
    content,
    actions,
    ...(Object.keys(position).length > 0
      ? {
          position: {
            x: asFiniteNumber(position.x),
            y: asFiniteNumber(position.y),
          },
        }
      : {}),
    metadata: asObject(data.metadata),
  };
};

const normalizeEdge = (rawEdge: unknown, index: number): IBotCanvasEdge => {
  const edge = asObject(rawEdge);
  const data = asObject(edge.data);

  return {
    id: normalizeCanvasNodeId(edge.id || data.id, `edge_${index + 1}`),
    source: asString(edge.source || data.source),
    target: asString(edge.target || data.target),
    sourceHandle: asString(edge.sourceHandle || data.sourceHandle) || undefined,
    targetHandle: asString(edge.targetHandle || data.targetHandle) || undefined,
    actionId: asString(edge.actionId || data.actionId) || undefined,
    replyId: asString(edge.replyId || data.replyId) || undefined,
    metadata: data,
  };
};

export const buildDefaultCanvasState = () => ({
  version: 1,
  nodes: [
    {
      id: 'node_default',
      type: 'botBlock',
      position: { x: 120, y: 120 },
      data: {
        triggerKey: REQUIRED_BOT_TRIGGER_KEYS.default,
        name: 'Main Menu',
        blockType: 'text',
        content: {
          text: 'Hi, thanks for messaging us. How can we help you today?',
        },
        actions: [],
        locked: true,
      },
    },
    {
      id: 'node_opt_out',
      type: 'botBlock',
      position: { x: 120, y: 360 },
      data: {
        triggerKey: REQUIRED_BOT_TRIGGER_KEYS.optOut,
        name: 'Opt Out Confirmation',
        blockType: 'text',
        content: {
          text: 'You have been opted out and will no longer receive promotional messages from us.',
        },
        actions: [],
        locked: true,
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});

const getRawCanvasState = (rawState: unknown) => {
  const body = asObject(rawState);
  if (Array.isArray(body.flows)) {
    return {
      version: Number(body.version) || 1,
      nodes: body.flows,
      edges: Array.isArray(body.edges) ? body.edges : [],
    };
  }

  return body;
};

const normalizeCanvasState = (rawState: unknown) => {
  const state = getRawCanvasState(rawState);
  const nodes = Array.isArray(state.nodes)
    ? state.nodes.map((node, index) => normalizeNode(node, index))
    : [];
  const edges = Array.isArray(state.edges)
    ? state.edges.map((edge, index) => normalizeEdge(edge, index))
    : [];

  return {
    version: Number(state.version) > 0 ? Number(state.version) : 1,
    nodes,
    edges,
  };
};

const assertText = (
  condition: boolean,
  message: string,
  errors: string[],
  warnings?: string[]
) => {
  if (!condition) {
    if (warnings) {
      warnings.push(message);
    } else {
      errors.push(message);
    }
  }
};

type CanvasMediaSnapshot = {
  id: string;
  fileType: 'image' | 'document' | 'video';
  cloudinaryUrl: string;
  metaHandle?: string;
  name?: string;
};

type CanvasMediaReference = {
  mediaId: string;
  expectedTypes: Array<'image' | 'document' | 'video'>;
  path: string;
  attach: (media: CanvasMediaSnapshot) => void;
};

const isValidMediaId = (value: unknown) =>
  typeof value === 'string' && objectIdPattern.test(value.trim());

const collectMediaReferences = (nodes: IBotCanvasNode[]) => {
  const references: CanvasMediaReference[] = [];

  for (const node of nodes) {
    const content = node.content || {};

    if (node.blockType === 'buttons' && content.mediaType) {
      const mediaType = String(content.mediaType).toLowerCase() as 'image' | 'document' | 'video';
      if (isValidMediaId(content.mediaId) && ['image', 'document', 'video'].includes(mediaType)) {
        references.push({
          mediaId: String(content.mediaId).trim(),
          expectedTypes: [mediaType],
          path: `${node.triggerKey}.content.mediaId`,
          attach: (media) => {
            content.media = media;
          },
        });
      }
    }

    if (node.blockType === 'image' || node.blockType === 'document' || node.blockType === 'video') {
      if (isValidMediaId(content.mediaId)) {
        references.push({
          mediaId: String(content.mediaId).trim(),
          expectedTypes: [node.blockType],
          path: `${node.triggerKey}.content.mediaId`,
          attach: (media) => {
            content.media = media;
          },
        });
      }
    }

    if (node.blockType === 'generic_carousel' && Array.isArray(content.cards)) {
      const cards = content.cards;
      cards.forEach((card, cardIndex) => {
        const typedCard = asObject(card);
        const mediaType = String(typedCard.mediaType || '').toLowerCase() as 'image' | 'video';
        if (isValidMediaId(typedCard.mediaId) && ['image', 'video'].includes(mediaType)) {
          references.push({
            mediaId: String(typedCard.mediaId).trim(),
            expectedTypes: [mediaType],
            path: `${node.triggerKey}.content.cards.${cardIndex}.mediaId`,
            attach: (media) => {
              typedCard.media = media;
              cards[cardIndex] = typedCard;
            },
          });
        }
      });
    }
  }

  return references;
};

const hydrateCanvasMediaReferences = async ({
  orgId,
  nodes,
  errors,
}: {
  orgId?: mongoose.Types.ObjectId | string;
  nodes: IBotCanvasNode[];
  errors: string[];
}) => {
  if (!orgId) {
    return;
  }

  const references = collectMediaReferences(nodes);
  if (references.length === 0) {
    return;
  }

  const uniqueMediaIds = [...new Set(references.map((reference) => reference.mediaId))];
  const mediaDocs = await Media.find({
    _id: { $in: uniqueMediaIds },
    orgId,
  }).select('_id fileType cloudinaryUrl metaHandle name');

  const mediaById = new Map(
    mediaDocs.map((media) => [
      String(media._id),
      {
        id: String(media._id),
        fileType: media.fileType,
        cloudinaryUrl: media.cloudinaryUrl,
        metaHandle: media.metaHandle,
        name: media.name,
      } satisfies CanvasMediaSnapshot,
    ])
  );

  for (const reference of references) {
    const media = mediaById.get(reference.mediaId);
    if (!media) {
      errors.push(`${reference.path} references a media asset that does not exist in this organization.`);
      continue;
    }

    if (!reference.expectedTypes.includes(media.fileType)) {
      errors.push(
        `${reference.path} references ${media.fileType} media, but expected ${reference.expectedTypes.join(' or ')}.`
      );
      continue;
    }

    reference.attach(media);
  }
};

const validateNodeContent = (node: IBotCanvasNode, errors: string[]) => {
  const content = node.content || {};

  if (!BLOCK_TYPES.has(node.blockType)) {
    errors.push(`${node.triggerKey} has unsupported blockType "${node.blockType}".`);
    return;
  }

  if (node.blockType === 'text') {
    assertText(
      typeof content.text === 'string' && content.text.trim().length > 0,
      `${node.triggerKey} text block requires content.text.`,
      errors
    );
  }

  if (node.blockType === 'buttons') {
    assertText(
      typeof content.bodyText === 'string' && content.bodyText.trim().length > 0,
      `${node.triggerKey} button block requires content.bodyText.`,
      errors
    );

    if (content.mediaType) {
      const mediaType = String(content.mediaType).toLowerCase();
      assertText(
        ['image', 'document', 'video'].includes(mediaType),
        `${node.triggerKey} button mediaType must be image, document, or video.`,
        errors
      );
      assertText(
        isValidMediaId(content.mediaId),
        `${node.triggerKey} button media header requires a valid mediaId.`,
        errors
      );
    }
  }

  if (node.blockType === 'list') {
    assertText(
      typeof content.bodyText === 'string' && content.bodyText.trim().length > 0,
      `${node.triggerKey} list block requires content.bodyText.`,
      errors
    );
    assertText(
      typeof content.buttonText === 'string' && content.buttonText.trim().length > 0,
      `${node.triggerKey} list block requires content.buttonText.`,
      errors
    );
    assertText(
      Array.isArray(content.sections) && content.sections.length > 0,
      `${node.triggerKey} list block requires at least one section.`,
      errors
    );
  }

  if (node.blockType === 'image' || node.blockType === 'document' || node.blockType === 'video') {
    assertText(
      isValidMediaId(content.mediaId),
      `${node.triggerKey} ${node.blockType} block requires a valid content.mediaId.`,
      errors
    );
  }

  if (node.blockType === 'location') {
    assertText(
      typeof content.latitude === 'number' && typeof content.longitude === 'number',
      `${node.triggerKey} location block requires numeric latitude and longitude.`,
      errors
    );
  }

  if (node.blockType === 'product_carousel') {
    assertText(
      typeof content.catalogId === 'string' &&
        content.catalogId.trim().length > 0 &&
        Array.isArray(content.sections) &&
        content.sections.length > 0,
      `${node.triggerKey} product carousel requires catalogId and sections.`,
      errors
    );
  }

  if (node.blockType === 'generic_carousel') {
    assertText(
      typeof content.bodyText === 'string' && content.bodyText.trim().length > 0,
      `${node.triggerKey} generic carousel requires content.bodyText.`,
      errors
    );
    assertText(
      Array.isArray(content.cards) && content.cards.length >= 2 && content.cards.length <= 10,
      `${node.triggerKey} generic carousel requires between 2 and 10 cards.`,
      errors
    );

    if (Array.isArray(content.cards)) {
      content.cards.forEach((card, cardIndex) => {
        const typedCard = asObject(card);
        assertText(
          typeof typedCard.bodyText === 'string' && typedCard.bodyText.trim().length > 0,
          `${node.triggerKey} carousel card ${cardIndex + 1} requires bodyText.`,
          errors
        );
        assertText(
          ['image', 'video'].includes(String(typedCard.mediaType || '').toLowerCase()),
          `${node.triggerKey} carousel card ${cardIndex + 1} mediaType must be image or video.`,
          errors
        );
        assertText(
          isValidMediaId(typedCard.mediaId),
          `${node.triggerKey} carousel card ${cardIndex + 1} requires a valid mediaId.`,
          errors
        );
        assertText(
          Array.isArray(typedCard.buttons) && typedCard.buttons.length > 0,
          `${node.triggerKey} carousel card ${cardIndex + 1} requires at least one button.`,
          errors
        );
      });
    }
  }
};

const compileCanvasState = async ({
  rawState,
  userId,
  orgId,
}: {
  rawState: unknown;
  userId?: string | mongoose.Types.ObjectId;
  orgId?: string | mongoose.Types.ObjectId;
}) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const normalized = normalizeCanvasState(rawState);
  const nodeById = new Map<string, IBotCanvasNode>();
  const nodeByTrigger = new Map<string, IBotCanvasNode>();

  if (normalized.nodes.length === 0) {
    errors.push('Canvas must contain at least DEFAULT and OPT_OUT nodes.');
  }

  for (const node of normalized.nodes) {
    if (nodeById.has(node.id)) {
      errors.push(`Duplicate node id "${node.id}".`);
    }
    nodeById.set(node.id, node);

    if (nodeByTrigger.has(node.triggerKey)) {
      errors.push(`Duplicate triggerKey "${node.triggerKey}".`);
    }
    nodeByTrigger.set(node.triggerKey, node);

    validateNodeContent(node, errors);
  }

  if (!nodeByTrigger.has(REQUIRED_BOT_TRIGGER_KEYS.default)) {
    errors.push('Canvas must include a DEFAULT root trigger node.');
  }

  if (!nodeByTrigger.has(REQUIRED_BOT_TRIGGER_KEYS.optOut)) {
    errors.push('Canvas must include an OPT_OUT compliance trigger node.');
  }

  for (const edge of normalized.edges) {
    if (!nodeById.has(edge.source)) {
      errors.push(`Edge "${edge.id}" has missing source node "${edge.source}".`);
    }
    if (!nodeById.has(edge.target)) {
      errors.push(`Edge "${edge.id}" has missing target node "${edge.target}".`);
    }
  }

  await hydrateCanvasMediaReferences({
    orgId,
    nodes: normalized.nodes,
    errors,
  });

  const triggerIndex: Record<string, string> = {};
  const replyIndex: Record<string, IBotCanvasCompiledAction> = {};
  const keywordIndex: Record<string, string> = {};

  for (const node of normalized.nodes) {
    triggerIndex[node.triggerKey] = node.id;
    keywordIndex[node.triggerKey] = node.id;
  }

  for (const keyword of DEFAULT_OPT_OUT_KEYWORDS) {
    keywordIndex[normalizeTriggerKey(keyword)] =
      triggerIndex[REQUIRED_BOT_TRIGGER_KEYS.optOut] || '';
  }

  const edgeByAction = new Map<string, IBotCanvasEdge>();
  const edgeByReply = new Map<string, IBotCanvasEdge>();
  for (const edge of normalized.edges) {
    if (edge.actionId) {
      edgeByAction.set(`${edge.source}:${edge.actionId}`, edge);
    }
    if (edge.replyId) {
      edgeByReply.set(`${edge.source}:${edge.replyId}`, edge);
    }
    if (edge.sourceHandle) {
      edgeByAction.set(`${edge.source}:${edge.sourceHandle}`, edge);
      edgeByReply.set(`${edge.source}:${edge.sourceHandle}`, edge);
    }
  }

  for (const node of normalized.nodes) {
    node.actions = node.actions.map((action) => {
      const edge =
        edgeByAction.get(`${node.id}:${action.actionId}`) ||
        (action.replyId ? edgeByReply.get(`${node.id}:${action.replyId}`) : undefined);
      const targetNode = edge?.target ? nodeById.get(edge.target) : undefined;

      return {
        ...action,
        nextTriggerKey: action.nextTriggerKey || targetNode?.triggerKey,
      };
    });

    for (const action of node.actions) {
      if (action.type === 'go_to_trigger') {
        if (!action.nextTriggerKey) {
          errors.push(`${node.triggerKey} action "${action.actionId}" is missing a target.`);
        } else if (!nodeByTrigger.has(normalizeTriggerKey(action.nextTriggerKey))) {
          errors.push(
            `${node.triggerKey} action "${action.actionId}" points to missing trigger "${action.nextTriggerKey}".`
          );
        }
      }

      if (action.type === 'open_url' && !action.url) {
        errors.push(`${node.triggerKey} action "${action.actionId}" requires a URL.`);
      }

      if (action.replyId) {
        replyIndex[action.replyId] = {
          nodeId: node.id,
          triggerKey: node.triggerKey,
          actionId: action.actionId,
          type: action.type,
          replyId: action.replyId,
          nextNodeId: action.nextTriggerKey
            ? triggerIndex[normalizeTriggerKey(action.nextTriggerKey)]
            : undefined,
          nextTriggerKey: action.nextTriggerKey
            ? normalizeTriggerKey(action.nextTriggerKey)
            : undefined,
          url: action.url,
        };
      }
    }

    if (
      node.triggerKey === REQUIRED_BOT_TRIGGER_KEYS.default &&
      node.blockType !== 'text' &&
      node.actions.length === 0
    ) {
      warnings.push('DEFAULT node currently has no actions, so it behaves as a terminal block.');
    }
  }

  const publishedState: IBotCanvasPublishedState = {
    version: normalized.version,
    nodes: normalized.nodes,
    edges: normalized.edges,
    compiled: {
      triggerIndex,
      replyIndex,
      keywordIndex,
    },
    publishedAt: new Date(),
    publishedBy: userId,
  };

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    publishedState,
  };
};

export const validateCanvasDraft = async ({
  draftState,
  orgId,
}: {
  draftState: unknown;
  orgId?: string | mongoose.Types.ObjectId;
}) => {
  const compiled = await compileCanvasState({ rawState: draftState, orgId });
  return {
    valid: compiled.valid,
    errors: compiled.errors,
    warnings: compiled.warnings,
    summary: {
      nodeCount: compiled.publishedState.nodes.length,
      edgeCount: compiled.publishedState.edges.length,
      triggerCount: Object.keys(compiled.publishedState.compiled.triggerIndex).length,
      replyRouteCount: Object.keys(compiled.publishedState.compiled.replyIndex).length,
    },
  };
};

export const invalidateCanvasCache = async (orgId: string | mongoose.Types.ObjectId) => {
  try {
    await canvasCacheRedis.del(buildPublishedCanvasCacheKey(orgId));
  } catch (error) {
    console.warn(`Failed to invalidate bot canvas cache for org ${String(orgId)}.`);
  }
};

export const ensureDefaultBotCanvas = async ({
  orgId,
  userId,
}: {
  orgId: mongoose.Types.ObjectId | string;
  userId?: mongoose.Types.ObjectId | string;
}) => {
  const existingCanvas = await BotCanvas.findOne({
    orgId,
    status: 'active',
  });

  if (!existingCanvas) {
    const defaultState = buildDefaultCanvasState();
    const compiled = await compileCanvasState({
      rawState: defaultState,
      userId,
      orgId,
    });

    await BotCanvas.create({
      orgId,
      name: 'Primary Bot Canvas',
      status: 'active',
      draftState: defaultState,
      publishedState: compiled.publishedState,
      createdBy: userId,
      updatedBy: userId,
    });
  }

  await BotSettings.findOneAndUpdate(
    { orgId },
    {
      $setOnInsert: {
        orgId,
        ...(userId ? { updatedBy: userId } : {}),
      },
    },
    {
      upsert: true,
      returnDocument: 'after',
    }
  );
};

export const getActiveCanvas = async (orgId: string | mongoose.Types.ObjectId) => {
  await ensureDefaultBotCanvas({ orgId });
  return BotCanvas.findOne({ orgId, status: 'active' });
};

export const getPublishedCanvasForOrg = async (orgId: string | mongoose.Types.ObjectId) => {
  const cacheKey = buildPublishedCanvasCacheKey(orgId);
  try {
    const cached = await canvasCacheRedis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as IBotCanvas;
    }
  } catch (error) {
    console.warn(`Failed to read bot canvas cache for org ${String(orgId)}; falling back to MongoDB.`);
  }

  await ensureDefaultBotCanvas({ orgId });
  const canvas = await BotCanvas.findOne({
    orgId,
    status: 'active',
    publishedState: { $exists: true },
  });

  if (canvas) {
    try {
      await canvasCacheRedis.set(
        cacheKey,
        JSON.stringify({
          orgId: String(canvas.orgId),
          status: canvas.status,
          publishedState: canvas.publishedState,
        }),
        'EX',
        LIVE_CANVAS_CACHE_TTL_SECONDS
      );
    } catch (error) {
      console.warn(`Failed to write bot canvas cache for org ${String(orgId)}.`);
    }
  }

  return canvas;
};

export const updateCanvasDraft = async ({
  orgId,
  draftState,
  userId,
}: {
  orgId: mongoose.Types.ObjectId | string;
  draftState: Record<string, unknown>;
  userId?: mongoose.Types.ObjectId | string;
}) => {
  await ensureDefaultBotCanvas({ orgId, userId });
  const canvas = await BotCanvas.findOneAndUpdate(
    { orgId, status: 'active' },
    {
      $set: {
        draftState: {
          ...draftState,
          updatedAt: new Date().toISOString(),
          ...(userId ? { updatedBy: String(userId) } : {}),
        },
        updatedBy: userId,
      },
    },
    {
      returnDocument: 'after',
      runValidators: true,
    }
  );

  if (!canvas) {
    throw new AppError('Active bot canvas not found for this organization.', 404);
  }

  return canvas;
};

export const publishCanvasDraft = async ({
  orgId,
  userId,
  draftState,
}: {
  orgId: mongoose.Types.ObjectId | string;
  userId?: mongoose.Types.ObjectId | string;
  draftState?: Record<string, unknown>;
}) => {
  await ensureDefaultBotCanvas({ orgId, userId });
  const canvas = await BotCanvas.findOne({ orgId, status: 'active' });
  if (!canvas) {
    throw new AppError('Active bot canvas not found for this organization.', 404);
  }

  const nextDraftState = draftState || canvas.draftState;
  const compiled = await compileCanvasState({
    rawState: nextDraftState,
    userId,
    orgId,
  });
  if (!compiled.valid) {
    throw new AppError(`Canvas validation failed: ${compiled.errors.join(' ')}`, 400);
  }

  if (draftState) {
    canvas.draftState = {
      ...draftState,
      updatedAt: new Date().toISOString(),
      ...(userId ? { updatedBy: String(userId) } : {}),
    };
  }
  canvas.publishedState = compiled.publishedState;
  canvas.updatedBy = userId as mongoose.Types.ObjectId | undefined;
  await canvas.save();
  await invalidateCanvasCache(orgId);

  return {
    canvas,
    validation: {
      valid: true,
      errors: compiled.errors,
      warnings: compiled.warnings,
      summary: {
        nodeCount: compiled.publishedState.nodes.length,
        edgeCount: compiled.publishedState.edges.length,
        triggerCount: Object.keys(compiled.publishedState.compiled.triggerIndex).length,
        replyRouteCount: Object.keys(compiled.publishedState.compiled.replyIndex).length,
      },
    },
  };
};

export const findPublishedNodeByTriggerKey = (
  canvas: IBotCanvas | null,
  triggerKey: string
) => {
  const published = canvas?.publishedState;
  if (!published) {
    return null;
  }

  const nodeId = published.compiled.triggerIndex[normalizeTriggerKey(triggerKey)];
  return published.nodes.find((node) => node.id === nodeId) || null;
};

export const resolveCanvasAction = ({
  canvas,
  replyId,
  activeTriggerKey,
}: {
  canvas: IBotCanvas | null;
  replyId?: string | null;
  activeTriggerKey?: string | null;
}) => {
  if (!canvas?.publishedState || !replyId) {
    return null;
  }

  const activeNode = activeTriggerKey
    ? findPublishedNodeByTriggerKey(canvas, activeTriggerKey)
    : null;
  const activeAction =
    activeNode?.actions.find((action) => action.replyId === replyId) || null;

  if (activeAction) {
    return {
      node: activeNode,
      action: activeAction,
      compiled: canvas.publishedState.compiled.replyIndex[replyId] || null,
    };
  }

  const compiled = canvas.publishedState.compiled.replyIndex[replyId];
  if (!compiled) {
    return null;
  }

  const node = canvas.publishedState.nodes.find((item) => item.id === compiled.nodeId) || null;
  const action = node?.actions.find((item) => item.actionId === compiled.actionId) || null;

  if (!node || !action) {
    return null;
  }

  return { node, action, compiled };
};

export const buildMetaPayloadFromCanvasNode = (node: IBotCanvasNode, to: string) =>
  buildMetaPayloadFromFlow(
    {
      ...node,
      _id: node.id,
      status: 'published',
      version: 1,
      publishedAt: new Date(),
    } as any,
    to
  );
