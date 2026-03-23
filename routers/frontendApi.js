import express from 'express';
const router = express.Router();
import analyticsController from  '../controllers/analytics/analytics.js'
import filtersMiddleware from '../middlewares/filtersMiddleware.js';
import userMiddleware from '../middlewares/userMiddleware.js';
import downloadController from '../controllers/downloads/download.js';


router.use('/analytics',userMiddleware, filtersMiddleware, analyticsController);
router.use('/download',userMiddleware, filtersMiddleware, downloadController);

export default router;