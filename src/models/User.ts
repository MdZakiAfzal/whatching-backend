import mongoose, { Schema, Document } from 'mongoose';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  name: string;
  email: string;
  password: string; 
  passwordChangedAt?: Date;
  refreshToken?: string;
  verificationToken?: string;
  isVerified: boolean;
  correctPassword(candidatePassword: string, userPassword: string): Promise<boolean>;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
}

const UserSchema: Schema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { 
      type: String, 
      required: true, 
      unique: true, 
      lowercase: true, 
      trim: true 
    },
    password: { type: String, required: true, select: false },
    passwordChangedAt: Date,
    refreshToken: { type: String, select: false },
    isVerified: { type: Boolean, default: false },
    verificationToken: String,
    passwordResetToken: String,
    passwordResetExpires: Date,
  },
  { timestamps: true }
);

// Encrypt password before saving
UserSchema.pre<IUser>('save', async function () {
  if (!this.isModified('password')) return;

  this.password = await bcrypt.hash(this.password, 12);
});

UserSchema.methods.correctPassword = async function (
  candidatePassword: string,
  userPassword: string
): Promise<boolean> {
  return await bcrypt.compare(candidatePassword, userPassword);
};

UserSchema.methods.createPasswordResetToken = function() {
  const resetToken = crypto.randomBytes(32).toString('hex');

  // Hash it and set to the database field
  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  // Token valid for 10 minutes
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;

  return resetToken; // Return the UNHASHED token to send via email
};

export default mongoose.model<IUser>('User', UserSchema);