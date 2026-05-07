import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import AppError from '../utils/AppError';

const handleJwtError = () => new AppError('Invalid token. Please log in again.', 401);
const handleJwtExpiredError = () => new AppError('Your token has expired. Please log in again.', 401);

const globalErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  let error = err;

  if (error.name === 'JsonWebTokenError') {
    error = handleJwtError();
  } else if (error.name === 'TokenExpiredError') {
    error = handleJwtExpiredError();
  }

  error.statusCode = error.statusCode || 500;
  error.status = error.status || 'error';

  if (config.env === 'development') {
    res.status(error.statusCode).json({
      status: error.status,
      error,
      message: error.message,
      stack: error.stack,
    });
  } else {
    // Production: Don't leak stack traces
    if (error.isOperational) {
      res.status(error.statusCode).json({
        status: error.status,
        message: error.message,
      });
    } else {
      // Programming or unknown error: don't leak details
      console.error('ERROR 💥', error);
      res.status(500).json({
        status: 'error',
        message: 'Something went very wrong!',
      });
    }
  }
};

export default globalErrorHandler;
