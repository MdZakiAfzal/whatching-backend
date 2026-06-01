import mongoose, { Document, Schema } from 'mongoose';

export type KnowledgeSourceType = 'text' | 'faq' | 'file';
export type KnowledgeSourceStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface IKnowledgeSource extends Document {
  orgId: mongoose.Types.ObjectId;
  createdBy?: mongoose.Types.ObjectId;
  type: KnowledgeSourceType;
  status: KnowledgeSourceStatus;
  title: string;
  content?: string;
  faqEntries?: Array<{ question: string; answer: string }>;
  filename?: string;
  mimeType?: string;
  cloudinaryUrl?: string;
  publicId?: string;
  ingestError?: string;
  chunkCount: number;
  lastIngestedAt?: Date;
}

const FaqEntrySchema = new Schema(
  {
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const KnowledgeSourceSchema = new Schema<IKnowledgeSource>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    type: { type: String, enum: ['text', 'faq', 'file'], required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'ready', 'failed'],
      default: 'pending',
      index: true,
    },
    title: { type: String, required: true, trim: true },
    content: { type: String },
    faqEntries: { type: [FaqEntrySchema], default: undefined },
    filename: { type: String, trim: true },
    mimeType: { type: String, trim: true },
    cloudinaryUrl: { type: String, trim: true },
    publicId: { type: String, trim: true },
    ingestError: { type: String, trim: true },
    chunkCount: { type: Number, default: 0 },
    lastIngestedAt: Date,
  },
  { timestamps: true }
);

KnowledgeSourceSchema.index({ orgId: 1, status: 1, createdAt: -1 });

export default mongoose.model<IKnowledgeSource>('KnowledgeSource', KnowledgeSourceSchema);
