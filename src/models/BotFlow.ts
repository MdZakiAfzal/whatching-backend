import mongoose, { Schema, Document } from 'mongoose';

export type BotFlowStatus = 'draft' | 'published' | 'archived';
export type BotFlowBlockType =
  | 'text'
  | 'buttons'
  | 'list'
  | 'image'
  | 'document'
  | 'video'
  | 'location'
  | 'product_carousel'
  | 'generic_carousel';

export type BotFlowActionType =
  | 'go_to_trigger'
  | 'escalate_to_agent'
  | 'end_conversation'
  | 'open_url';

export interface IBotFlowAction {
  actionId: string;
  type: BotFlowActionType;
  label?: string;
  replyId?: string;
  nextTriggerKey?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface IBotFlowMediaReference {
  mediaId: string;
  mediaType?: 'image' | 'document' | 'video';
  media?: {
    id: string;
    fileType: 'image' | 'document' | 'video';
    cloudinaryUrl: string;
    metaHandle?: string;
    name?: string;
  };
}

export type IBotFlowContent = Record<string, unknown> & Partial<IBotFlowMediaReference>;

export interface IBotFlow extends Document {
  orgId: mongoose.Types.ObjectId;
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  status: BotFlowStatus;
  triggerKey: string;
  name: string;
  blockType: BotFlowBlockType;
  sortOrder: number;
  version: number;
  content: IBotFlowContent;
  actions: IBotFlowAction[];
  publishedAt?: Date;
  archivedAt?: Date;
}

const BotFlowActionSchema = new Schema<IBotFlowAction>(
  {
    actionId: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['go_to_trigger', 'escalate_to_agent', 'end_conversation', 'open_url'],
      required: true,
    },
    label: { type: String, trim: true },
    replyId: { type: String, trim: true },
    nextTriggerKey: { type: String, trim: true },
    url: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { _id: false }
);

const BotFlowSchema = new Schema<IBotFlow>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
      index: true,
    },
    triggerKey: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    blockType: {
      type: String,
      enum: ['text', 'buttons', 'list', 'image', 'document', 'video', 'location', 'product_carousel', 'generic_carousel'],
      required: true,
    },
    sortOrder: { type: Number, default: 0 },
    version: { type: Number, default: 1 },
    content: { type: Schema.Types.Mixed, default: {} },
    actions: { type: [BotFlowActionSchema], default: [] },
    publishedAt: Date,
    archivedAt: Date,
  },
  { timestamps: true }
);

BotFlowSchema.index({ orgId: 1, triggerKey: 1, version: -1 });
BotFlowSchema.index(
  { orgId: 1, triggerKey: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['draft', 'published'] },
    },
  }
);

export default mongoose.model<IBotFlow>('BotFlow', BotFlowSchema);
