import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { Inventory, Dealership, sequelize } from './database.js';
const importInventory = async () => {
    // sync alter true
    // await Inventory.sync({ force: true });
    // return

    const csvPath = path.resolve('./data/inventory.csv');
    let currentChunk = [];
    let totalImported = 0;
    const today = new Date().toISOString().split('T')[0];

    try {
        const dealers = await Dealership.findAll();
        const dealerMap = new Map(dealers.map(d => [d.name, d.id]));

        const inputStream = fs.createReadStream(csvPath).pipe(csv());

        for await (const data of inputStream) {
            const localDate = new Date(data.Date);
            // console.log(localDate)
            // Subtract the timezone offset in minutes
            const date = new Date(localDate.getTime() - localDate.getTimezoneOffset() * 60000).toISOString().split('T')[0];
            // console.log(date)
            currentChunk.push({
                first_seen: date,
                last_seen: date,  // Updated every time
                type: data.Used,
                year: parseInt(data.Year) || 0,
                make: data.Make,
                model: data.Model,
                trim: data.Trim || null,
                mileage: parseInt(data.Mileage) || 0,
                price: parseInt(data.Price) || 0,
                url: data.URL,
                vin: data['Vin#'],
                dealershipId: dealerMap.get(data['Dealership Name']) || null
            });

            if (currentChunk.length >= 500) {
                await processBatch(currentChunk);
                totalImported += currentChunk.length;
                currentChunk = [];
            }
        }

        if (currentChunk.length > 0) {
            await processBatch(currentChunk);
            totalImported += currentChunk.length;
        }

        console.log(`Sir, processed ${totalImported} records successfully.`);
    } catch (error) {
        console.error("Sir, error in import:", error);
    } finally {
        await sequelize.close();
    }
};

// Helper function for the Upsert
const processBatch = async (batch) => {
    await Inventory.bulkCreate(batch, {
        updateOnDuplicate: ['last_seen', 'price', 'mileage'],
        // If URL exists, update these 3 fields; ignore 'first_seen'
    });
};
importInventory();