import mongoose, { Schema, Document } from 'mongoose';

export interface IWhatsAppTemplate extends Document {
  orgId: mongoose.Types.ObjectId;
  wabaId: string;
  templateId: string; // The ID from Meta
  name: string;
  language: string;
  category: string;
  status: string;
  components: any[]; // The raw JSON structure of the template (headers, body, buttons)
  rejectionReason?: string;
  qualityScore?: string;
  namespace?: string;
  lastSyncedAt: Date;
}

const WhatsAppTemplateSchema: Schema = new Schema({
  orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  wabaId: { type: String, required: true },
  templateId: { type: String, required: true },
  name: { type: String, required: true },
  language: { type: String, required: true },
  category: { type: String, required: true, trim: true },
  status: { type: String, required: true, trim: true },
  components: { type: [Schema.Types.Mixed], default: [] },
  rejectionReason: String,
  qualityScore: String,
  namespace: String,
  lastSyncedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// CRITICAL INDEXES for fast lookup and syncing
WhatsAppTemplateSchema.index({ orgId: 1, templateId: 1 }, { unique: true });
WhatsAppTemplateSchema.index({ orgId: 1, status: 1 });
WhatsAppTemplateSchema.index({ orgId: 1, name: 1 });

export default mongoose.model<IWhatsAppTemplate>('WhatsAppTemplate', WhatsAppTemplateSchema);
