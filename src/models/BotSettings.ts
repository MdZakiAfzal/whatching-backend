import mongoose, { Schema, Document } from 'mongoose';

export interface IBotSettings extends Document {
  orgId: mongoose.Types.ObjectId;
  isBotEnabled: boolean;
  isAiEnabled: boolean;
  systemPrompt: string;
  defaultTriggerKey: string;
  greetingKeywords: string[];
  optOutKeywords: string[];
  escalationTriggerIds: string[];
  autoTimeoutMinutes: number;
  geminiModel: string;
  updatedBy?: mongoose.Types.ObjectId;
}

const BotSettingsSchema = new Schema<IBotSettings>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    isBotEnabled: { type: Boolean, default: false },
    isAiEnabled: { type: Boolean, default: true },
    systemPrompt: {
      type: String,
      default:
        'You are a helpful WhatsApp assistant for this business. Answer accurately, stay concise, and route to supported flows when useful.',
    },
    defaultTriggerKey: { type: String, default: 'DEFAULT', trim: true, uppercase: true },
    greetingKeywords: {
      type: [String],
      default: ['HI', 'HELLO', 'MENU', 'START'],
    },
    optOutKeywords: {
      type: [String],
      default: ['STOP', 'UNSUBSCRIBE', 'OPT OUT', 'OPTOUT', 'CANCEL'],
    },
    escalationTriggerIds: {
      type: [String],
      default: [],
    },
    autoTimeoutMinutes: { type: Number, default: 60, min: 5, max: 1440 },
    geminiModel: { type: String, default: 'gemini-2.5-flash', trim: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export default mongoose.model<IBotSettings>('BotSettings', BotSettingsSchema);
