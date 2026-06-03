import mongoose, { Schema, Document } from 'mongoose';
import {
  BotFlowActionType,
  BotFlowBlockType,
  IBotFlowAction,
  IBotFlowContent,
} from './BotFlow';

export type BotCanvasStatus = 'active' | 'archived';

export interface IBotCanvasNode {
  id: string;
  triggerKey: string;
  name: string;
  blockType: BotFlowBlockType;
  sortOrder?: number;
  content: IBotFlowContent;
  actions: IBotFlowAction[];
  position?: {
    x: number;
    y: number;
  };
  metadata?: Record<string, unknown>;
}

export interface IBotCanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  actionId?: string;
  replyId?: string;
  metadata?: Record<string, unknown>;
}

export interface IBotCanvasCompiledAction {
  nodeId: string;
  triggerKey: string;
  actionId: string;
  type: BotFlowActionType;
  replyId?: string;
  nextNodeId?: string;
  nextTriggerKey?: string;
  url?: string;
}

export interface IBotCanvasPublishedState {
  version: number;
  nodes: IBotCanvasNode[];
  edges: IBotCanvasEdge[];
  compiled: {
    triggerIndex: Record<string, string>;
    replyIndex: Record<string, IBotCanvasCompiledAction>;
    keywordIndex: Record<string, string>;
  };
  publishedAt: Date;
  publishedBy?: mongoose.Types.ObjectId | string;
}

export interface IBotCanvas extends Document {
  orgId: mongoose.Types.ObjectId;
  name: string;
  status: BotCanvasStatus;
  draftState: Record<string, unknown>;
  publishedState?: IBotCanvasPublishedState;
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  archivedBy?: mongoose.Types.ObjectId;
  archivedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const BotCanvasSchema = new Schema<IBotCanvas>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true, default: 'Primary Bot Canvas' },
    status: {
      type: String,
      enum: ['active', 'archived'],
      default: 'active',
      index: true,
    },
    draftState: { type: Schema.Types.Mixed, default: {} },
    publishedState: { type: Schema.Types.Mixed },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    archivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    archivedAt: Date,
  },
  { timestamps: true }
);

BotCanvasSchema.index(
  { orgId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
  }
);

export default mongoose.model<IBotCanvas>('BotCanvas', BotCanvasSchema);
