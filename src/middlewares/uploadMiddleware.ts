import multer from 'multer';
import AppError from '../utils/AppError';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

export const optionalSingleAttachmentUpload = (fieldName: string) => {
  const middleware = upload.single(fieldName);

  return (req: any, res: any, next: any) => {
    if (!req.is('multipart/form-data')) {
      return next();
    }

    middleware(req, res, (error: any) => {
      if (!error) {
        return next();
      }

      if (error instanceof multer.MulterError) {
        return next(new AppError(error.message, 400));
      }

      next(error);
    });
  };
};

export const multipleAttachmentUpload = (fieldName: string, maxCount: number = 10) => {
  const middleware = upload.array(fieldName, maxCount);

  return (req: any, res: any, next: any) => {
    if (!req.is('multipart/form-data')) {
      return next();
    }

    middleware(req, res, (error: any) => {
      if (!error) {
        return next();
      }

      if (error instanceof multer.MulterError) {
        return next(new AppError(error.message, 400));
      }

      next(error);
    });
  };
};