import mongoose, { Schema, Document } from 'mongoose';

export interface IMedia extends Document {
  orgId: mongoose.Types.ObjectId;
  name: string;
  fileType: 'image' | 'document' | 'video';
  fileSize: number; // Storing bytes helps with plan quota limits later
  cloudinaryUrl: string; // The public URL for active sessions
  metaHandle?: string; // The strictly required handle for Meta Template creation
  createdAt: Date;
  updatedAt: Date;
}

const MediaSchema = new Schema<IMedia>({
  orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  name: { type: String, required: true, trim: true },
  fileType: { type: String, enum: ['image', 'document', 'video'], required: true },
  fileSize: { type: Number, required: true },
  cloudinaryUrl: { type: String, required: true },
  metaHandle: { type: String }, // Optional, as Meta might occasionally fail while Cloudinary succeeds
}, { timestamps: true });

// Index for fast dashboard retrieval and searching
MediaSchema.index({ orgId: 1, name: 1 });
// Index to quickly fetch assets that are template-ready
MediaSchema.index({ orgId: 1, metaHandle: 1 });

export default mongoose.model<IMedia>('Media', MediaSchema);