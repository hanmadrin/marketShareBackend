import express, { json, urlencoded } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();

// FIX __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import ExpressError from './utilities/expressError.js';
import frontendApi from './routers/frontendApi.js';
import authRouter from './routers/auth.js';

const port = process.env.PORT || 3000;

app.use(cors());
app.use(json({ limit: '50mb' }));
app.use(urlencoded({ limit: '50mb', extended: true }));

app.use('/api/auth', authRouter);
app.use('/api', frontendApi);

app.use(express.static(path.join(__dirname, '../marketShareFrontend/dist')));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../marketShareFrontend/dist', 'index.html'));
});
app.listen(port, "0.0.0.0", () => {
  console.log(`server running at http://localhost:${port}`);
});