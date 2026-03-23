import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { Inventory, Dealership, sequelize } from './database.js';

const importInventory = async () => {
    const csvPath = path.resolve('./data/inventory.csv');

    let totalImported = 0;

    try {
        const dealers = await Dealership.findAll();
        const dealerMap = new Map(dealers.map(d => [d.name, d.id]));

        const dateMap = new Map(); // { date: [records] }

        const inputStream = fs.createReadStream(csvPath).pipe(csv());

        // STEP 1: Read & group by date
        for await (const data of inputStream) {
            const localDate = new Date(data.Date);
            const date = new Date(
                localDate.getTime() - localDate.getTimezoneOffset() * 60000
            ).toISOString().split('T')[0];

            const record = {
                first_seen: date,
                last_seen: date,
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
            };

            if (!dateMap.has(date)) {
                dateMap.set(date, []);
            }
            dateMap.get(date).push(record);
        }

        // STEP 2: Sort dates
        const sortedDates = Array.from(dateMap.keys()).sort();

        // STEP 3: Fill missing dates
        const filledData = [];
        let prevDateData = [];

        for (let i = 0; i < sortedDates.length; i++) {
            const currentDate = sortedDates[i];
            const currentData = dateMap.get(currentDate);

            if (i > 0) {
                const prevDate = new Date(sortedDates[i - 1]);
                const currDate = new Date(currentDate);

                const diffDays = Math.floor(
                    (currDate - prevDate) / (1000 * 60 * 60 * 24)
                );

                // Fill missing days
                for (let d = 1; d < diffDays; d++) {
                    const missingDate = new Date(prevDate);
                    missingDate.setDate(prevDate.getDate() + d);

                    const missingDateStr = missingDate.toISOString().split('T')[0];

                    const copied = prevDateData.map(item => ({
                        ...item,
                        first_seen: missingDateStr,
                        last_seen: missingDateStr
                    }));

                    filledData.push(...copied);
                }
            }

            // Push actual data
            filledData.push(...currentData);

            prevDateData = currentData;
        }

        console.log(`Sir, total records after filling: ${filledData.length}`);

        // STEP 4: Insert in batches
        let chunk = [];

        for (const item of filledData) {
            chunk.push(item);

            if (chunk.length >= 500) {
                await processBatch(chunk);
                totalImported += chunk.length;
                chunk = [];
            }
        }

        if (chunk.length > 0) {
            await processBatch(chunk);
            totalImported += chunk.length;
        }

        console.log(`Sir, processed ${totalImported} records successfully.`);
    } catch (error) {
        console.error("Sir, error in import:", error);
    } finally {
        await sequelize.close();
    }
};

// UPSERT helper
const processBatch = async (batch) => {
    await Inventory.bulkCreate(batch, {
        updateOnDuplicate: ['last_seen', 'price', 'mileage']
    });
};

importInventory();