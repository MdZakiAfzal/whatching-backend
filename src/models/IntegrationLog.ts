import mongoose, { Schema, Document } from 'mongoose';

export interface IIntegrationLog extends Document {
  orgId: mongoose.Types.ObjectId;
  actorUserId?: mongoose.Types.ObjectId;
  action: string;
  status: 'success' | 'failed';
  details?: Record<string, unknown>;
  externalRef?: string;
}

const IntegrationLogSchema: Schema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['success', 'failed'],
      required: true,
    },
    details: { type: Schema.Types.Mixed },
    externalRef: { type: String, trim: true },
  },
  { timestamps: true }
);

IntegrationLogSchema.index({ orgId: 1, createdAt: -1 });
IntegrationLogSchema.index({ orgId: 1, action: 1, createdAt: -1 });

export default mongoose.model<IIntegrationLog>('IntegrationLog', IntegrationLogSchema);
