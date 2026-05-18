import mongoose, { Schema, Document } from 'mongoose';

export interface ITemplateDraft extends Document {
  orgId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  name: string;
  language: string;
  category: string;
  components: Record<string, unknown>[];
  allowCategoryChange?: boolean;
  status:
    | 'draft'
    | 'submitted'
    | 'pending_review'
    | 'approved'
    | 'rejected'
    | 'disabled'
    | 'deleted';
  metaTemplateId?: string;
  rejectionReason?: string;
  lastSubmittedAt?: Date;
}

const TemplateDraftSchema: Schema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true, trim: true },
    language: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    components: { type: [Schema.Types.Mixed], default: [] },
    allowCategoryChange: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['draft', 'submitted', 'pending_review', 'approved', 'rejected', 'disabled', 'deleted'],
      default: 'draft',
    },
    metaTemplateId: { type: String, trim: true },
    rejectionReason: String,
    lastSubmittedAt: Date,
  },
  { timestamps: true }
);

TemplateDraftSchema.index({ orgId: 1, status: 1, updatedAt: -1 });
TemplateDraftSchema.index({ orgId: 1, name: 1, language: 1 });
TemplateDraftSchema.index(
  { orgId: 1, metaTemplateId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      metaTemplateId: { $exists: true, $type: 'string' },
    },
  }
);

export default mongoose.model<ITemplateDraft>('TemplateDraft', TemplateDraftSchema);
