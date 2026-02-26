import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { Inventory, Dealership, sequelize } from './database.js'; // Adjust path

const importInventory = async () => {
    const results = [];
    const csvPath = path.resolve('./data/inventory.csv');

    // 1. Get all dealerships to map names to IDs
    const dealers = await Dealership.findAll();
    const dealerMap = new Map(dealers.map(d => [d.name, d.id]));

    fs.createReadStream(csvPath)
        .pipe(csv())
        .on('data', (data) => {
            // Format: "2/9/2026" -> "2026-02-09"
            const rawDate = new Date(data.Date);
            const formattedDate = !isNaN(rawDate) ? rawDate.toISOString().split('T')[0] : null;

            results.push({
                date: formattedDate,
                type: data.Used,
                year: parseInt(data.Year),
                make: data.Make,
                model: data.Model,
                trim: data.Trim,
                mileage: isNaN(parseInt(data.Mileage || 0)) ? 0 : parseInt(data.Mileage || 0),
                price: isNaN(parseInt(data.Price || 0)) ? 0 : (parseInt(data.Price || 0)),
                url: data.URL,
                vin: data['Vin#'],
                dealershipId: dealerMap.get(data['Dealership Name'])
            });
        })
        .on('end', async () => {
            try {
                const CHUNK_SIZE = 500; // Try 500 records at a time
                for (let i = 0; i < results.length; i += CHUNK_SIZE) {
                    const chunk = results.slice(i, i + CHUNK_SIZE);
                    await Inventory.bulkCreate(chunk);
                    console.log(`Imported ${i + chunk.length} records...`);
                }
                console.log(`Successfully imported ${results.length} inventory items, Sir.`);
            } catch (error) {
                console.error('Import failed:', error);
            } finally {
                await sequelize.close();
            }
        });
};

importInventory();