import express from 'express';
const router = express.Router();
import { login, verifyToken } from '../controllers/auth/login.js';

router.post('/login', login);
router.get('/verify', verifyToken);

export default router;