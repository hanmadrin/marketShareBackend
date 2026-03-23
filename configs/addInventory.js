import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { Inventory, Dealership, sequelize } from './database.js';


const importInventory = async () => {
    const csvPath = path.resolve('./data/inventory.csv');
    let currentChunk = [];
    let totalImported = 0;

    try {
        // 1. Map Dealers for ID lookups
        const dealers = await Dealership.findAll();
        const dealerMap = new Map(dealers.map(d => [d.name, d.id]));

        // 2. Process Stream in Chunks
        await new Promise((resolve, reject) => {
            fs.createReadStream(csvPath)
                .pipe(csv())
                .on('data', async (data) => {
                    const rawDate = new Date(data.Date);
                    const formattedDate = !isNaN(rawDate) ? rawDate.toISOString().split('T')[0] : null;

                    currentChunk.push({
                        date: formattedDate,
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

                    // When chunk is full, pause stream and save to DB
                    if (currentChunk.length >= 500) {
                        const stream = fs.createReadStream(csvPath).pause(); // Pause to prevent memory overflow
                        const batch = [...currentChunk];
                        currentChunk = []; // Clear chunk
                        
                        await Inventory.bulkCreate(batch, { ignoreDuplicates: true });
                        totalImported += batch.length;
                        stream.resume();
                    }
                })
                .on('end', async () => {
                    // Import remaining records
                    if (currentChunk.length > 0) {
                        await Inventory.bulkCreate(currentChunk, { ignoreDuplicates: true });
                        totalImported += currentChunk.length;
                    }
                    resolve();
                })
                .on('error', reject);
        });

        console.log(`Sir, import complete. Processed approximately ${totalImported} records.`);

    } catch (error) {
        console.error("Sir, an error occurred during the chunked import:", error);
    } finally {
        await sequelize.close();
    }
};

importInventory();