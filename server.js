import express, { json, urlencoded } from 'express';
import cors from 'cors';
const app = express();
import ExpressError from './utilities/expressError.js';
// const { connectToDatabase } = require('./config/config');
import apiRoutes from './controllers/analytics.js';
const port = process.env.PORT || 4566;
app.use(cors());
app.use(json({limit: '50mb'}));
app.use(urlencoded({limit: '50mb',extended: true }));


app.use('/api', apiRoutes);
app.listen(port, "0.0.0.0",() => {
    console.log(`server running at http://localhost:${port}`)
});

// connectToDatabase();