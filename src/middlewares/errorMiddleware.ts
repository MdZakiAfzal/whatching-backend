import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import AppError from '../utils/AppError';

const handleJwtError = () => new AppError('Invalid token. Please log in again.', 401);
const handleJwtExpiredError = () => new AppError('Your token has expired. Please log in again.', 401);
const handleCastErrorDB = (err: any) =>
  new AppError(`Invalid ${err.path}: ${err.value}`, 400);
const handleValidationErrorDB = (err: any) =>
  new AppError(
    Object.values(err.errors || {})
      .map((val: any) => val.message)
      .join(', ') || 'Validation failed.',
    400
  );
const handleDuplicateFieldsDB = (err: any) => {
  const entries = Object.entries(err.keyValue || {}) as Array<[string, unknown]>;
  const details = entries.map(([key, value]) => `${key}: ${String(value)}`).join(', ');
  return new AppError(`Duplicate value for unique field(s): ${details}`, 409);
};
const handleAxiosProviderError = (err: any) => {
  const providerMessage =
    err.response?.data?.error?.message ||
    err.response?.data?.message ||
    err.message ||
    'External provider request failed.';
  const statusCode = typeof err.response?.status === 'number' && err.response.status >= 400 && err.response.status < 600
    ? err.response.status
    : 502;
  return new AppError(providerMessage, statusCode);
};

const buildErrorResponse = (error: any, includeStack: boolean) => ({
  status: error.status || 'error',
  message: error.message,
  code: error.code || error.errorCode || null,
  errorType: error.name || 'Error',
  details: error.details || error.keyValue || null,
  ...(includeStack ? { stack: error.stack } : {}),
});

const globalErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  let error = err;

  if (error.name === 'JsonWebTokenError') {
    error = handleJwtError();
  } else if (error.name === 'TokenExpiredError') {
    error = handleJwtExpiredError();
  } else if (error.name === 'CastError') {
    error = handleCastErrorDB(error);
  } else if (error.name === 'ValidationError') {
    error = handleValidationErrorDB(error);
  } else if (error.code === 11000) {
    error = handleDuplicateFieldsDB(error);
  } else if (error.isAxiosError) {
    error = handleAxiosProviderError(error);
  }

  error.statusCode = error.statusCode || 500;
  error.status = error.status || 'error';

  const logPayload = {
    method: req.method,
    path: req.originalUrl,
    statusCode: error.statusCode,
    errorType: error.name || 'Error',
    message: error.message,
    code: error.code || error.errorCode || null,
    details: error.keyValue || error.details || null,
  };

  if (config.env === 'development') {
    console.error('ERROR 💥', logPayload, error.stack);
    return res.status(error.statusCode).json(buildErrorResponse(error, true));
  }

  console.error('ERROR 💥', logPayload);

  if (error.isOperational) {
    return res.status(error.statusCode).json(buildErrorResponse(error, false));
  }

  res.status(500).json({
    status: 'error',
    message: 'Something went very wrong!',
    code: error.code || null,
    errorType: error.name || 'Error',
  });
};

export default globalErrorHandler;
