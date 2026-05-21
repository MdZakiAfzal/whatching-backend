import express from 'express';
import * as mediaController from '../controllers/mediaController';
import { protect } from '../middlewares/authMiddleware';
import { setOrgContext } from '../middlewares/orgMiddleware';
import { restrictTo } from '../middlewares/roleMiddleware';
import { multipleAttachmentUpload } from '../middlewares/uploadMiddleware';
import { validate } from '../middlewares/validateMiddleware';
import { mediaParamsSchema, bulkDeleteMediaSchema } from '../validations/mediaValidation';

const router = express.Router();

router.use(protect);
router.use(setOrgContext);

// 1. Get the gallery
router.get('/', restrictTo('owner', 'admin', 'agent'), mediaController.getMediaLibrary);

// 2. Upload up to 10 files
router.post(
  '/upload',
  restrictTo('owner', 'admin', 'agent'),
  multipleAttachmentUpload('files', 10),
  mediaController.bulkUploadMedia
);

// 3. Bulk Delete Media (Must be ABOVE /:mediaId)
router.post(
  '/bulk-delete',
  restrictTo('owner', 'admin'),
  validate(bulkDeleteMediaSchema),
  mediaController.bulkDeleteMedia
);

// 4. Get a specific media item by ID
router.get(
  '/:mediaId',
  restrictTo('owner', 'admin', 'agent'),
  validate(mediaParamsSchema),
  mediaController.getMedia
);

export default router;