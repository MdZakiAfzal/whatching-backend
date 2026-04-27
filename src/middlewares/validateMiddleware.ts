import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import AppError from '../utils/AppError';

// Using z.ZodSchema instead of AnyZodObject to bypass versioning issues
export const validate = (schema: z.ZodSchema) => 
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        // .issues is the standard way to map Zod errors in 2026
        const message = error.issues.map((i: any) => i.message).join(', ');
        return next(new AppError(message, 400));
      }
      next(error);
    }
};