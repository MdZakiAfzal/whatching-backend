import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../config';
import User from '../models/User';
import * as orgService from '../services/organizationService';

// Helper to sign tokens
export const signToken = (id: string, secret: string, expires: string) => {
  const options: SignOptions = {
    expiresIn: expires as any, // 'as any' helps if the string format is dynamic
  };

  // We cast 'secret' as a string to ensure TS chooses the correct overload
  return jwt.sign({ id }, secret as string, options);
};

export const registerUser = async (userData: any) => {
  // 1. Create the User
  const user = await User.create({
    name: userData.name,
    email: userData.email,
    password: userData.password,
  });

  return { user };
};