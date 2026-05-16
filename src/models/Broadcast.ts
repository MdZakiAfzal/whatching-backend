import mongoose, { Schema, Document } from 'mongoose';

export type BroadcastStatus =
  | 'draft'
  | 'scheduled'
  | 'processing'
  | 'in_progress'
  | 'completed'
  | 'canceled'
  | 'failed';

export type BroadcastAudienceMode = 'all' | 'tags' | 'specific';
export type BroadcastTagMatchMode = 'any' | 'all';

export interface IBroadcast extends Document {
  orgId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  startedBy?: mongoose.Types.ObjectId;
  name: string;
  status: BroadcastStatus;
  template: {
    templateId: string;
    name: string;
    language: string;
    category: string;
  };
  payload: {
    components: Record<string, unknown>[];
  };
  audience: {
    mode: BroadcastAudienceMode;
    tags: string[];
    tagMatch: BroadcastTagMatchMode;
    subscriberIds: mongoose.Types.ObjectId[];
    optedInOnly: boolean;
  };
  scheduledAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  canceledAt?: Date;
  lastError?: string;
  stats: {
    totalRecipients: number;
    queuedRecipients: number;
    sentRecipients: number;
    deliveredRecipients: number;
    readRecipients: number;
    failedRecipients: number;
    skippedRecipients: number;
    canceledRecipients: number;
  };
}

const BroadcastSchema: Schema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    startedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'processing', 'in_progress', 'completed', 'canceled', 'failed'],
      default: 'draft',
    },
    template: {
      templateId: { type: String, required: true, trim: true },
      name: { type: String, required: true, trim: true },
      language: { type: String, required: true, trim: true },
      category: { type: String, required: true, trim: true },
    },
    payload: {
      components: { type: [Schema.Types.Mixed], default: [] },
    },
    audience: {
      mode: {
        type: String,
        enum: ['all', 'tags', 'specific'],
        required: true,
      },
      tags: { type: [String], default: [] },
      tagMatch: {
        type: String,
        enum: ['any', 'all'],
        default: 'any',
      },
      subscriberIds: [{ type: Schema.Types.ObjectId, ref: 'Subscriber' }],
      optedInOnly: { type: Boolean, default: true },
    },
    scheduledAt: Date,
    startedAt: Date,
    completedAt: Date,
    canceledAt: Date,
    lastError: String,
    stats: {
      totalRecipients: { type: Number, default: 0 },
      queuedRecipients: { type: Number, default: 0 },
      sentRecipients: { type: Number, default: 0 },
      deliveredRecipients: { type: Number, default: 0 },
      readRecipients: { type: Number, default: 0 },
      failedRecipients: { type: Number, default: 0 },
      skippedRecipients: { type: Number, default: 0 },
      canceledRecipients: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

BroadcastSchema.index({ orgId: 1, status: 1, createdAt: -1 });
BroadcastSchema.index({ orgId: 1, scheduledAt: 1, status: 1 });

export default mongoose.model<IBroadcast>('Broadcast', BroadcastSchema);
