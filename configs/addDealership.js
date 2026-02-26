import fs from 'fs';
import path from 'path';
import { Dealership, sequelize } from './database.js'; // Adjust this path to your model file

const addDealerships = async () => {
    try {
        // 1. Read and parse the JSON file
        const dataPath = path.resolve('./data/dealership.json');
        const dealerships = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

        // 2. Connect and Sync (ensure table exists)
        await sequelize.authenticate();
        
        // 3. Bulk Insert
        await Dealership.bulkCreate(dealerships);

        console.log(`Successfully inserted ${dealerships.length} dealerships.`);
    } catch (error) {
        console.error('Failed to insert data:', error);
    } finally {
        await sequelize.close();
    }
};

addDealerships();