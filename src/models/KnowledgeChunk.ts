import mongoose, { Document, Schema } from 'mongoose';

export interface IKnowledgeChunk extends Document {
  orgId: mongoose.Types.ObjectId;
  sourceId: mongoose.Types.ObjectId;
  order: number;
  content: string;
  normalizedContent: string;
  metadata?: Record<string, unknown>;
}

const KnowledgeChunkSchema = new Schema<IKnowledgeChunk>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    sourceId: { type: Schema.Types.ObjectId, ref: 'KnowledgeSource', required: true, index: true },
    order: { type: Number, required: true },
    content: { type: String, required: true },
    normalizedContent: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

KnowledgeChunkSchema.index({ orgId: 1, sourceId: 1, order: 1 }, { unique: true });
KnowledgeChunkSchema.index({ content: 'text', normalizedContent: 'text' });

export default mongoose.model<IKnowledgeChunk>('KnowledgeChunk', KnowledgeChunkSchema);
