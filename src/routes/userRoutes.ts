import express from 'express';
import * as authController from '../controllers/authController';
import { validate } from '../middlewares/validateMiddleware';
import { protect } from '../middlewares/authMiddleware';
import { signupSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from '../validations/authValidation';

const router = express.Router();

// Public routes
router.post('/signup', validate(signupSchema), authController.signup);
router.get('/verify/:token', authController.verifyEmail);
router.post('/resend-verification', authController.resendVerification);
router.post('/login', validate(loginSchema), authController.login);
router.post('/refresh-token', authController.refreshToken);
router.post('/forgot-password', validate(forgotPasswordSchema),authController.forgotPassword);
router.patch('/reset-password/:token', validate(resetPasswordSchema), authController.resetPassword);

// Protected Routes
router.get('/me', protect, authController.getMe);
router.get('/logout', authController.logout);

export default router;