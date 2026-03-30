import express from 'express';
import csv from 'csv-parser';
import { Readable } from 'stream';
import { Inventory, Dealership, sequelize } from '../configs/database.js';

const router = express.Router();

// POST endpoint to receive CSV data and import to database
router.post('/inventory', async (req, res) => {
    try {
        const { csvData } = req.body;
        
        if (!csvData || typeof csvData !== 'string') {
            return res.status(400).json({ 
                success: false, 
                message: 'CSV data is required and must be a string' 
            });
        }

        console.log('Received inventory data, processing...');
        
        // Parse CSV data
        const records = await parseCSV(csvData);
        
        if (records.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'No valid records found in CSV data' 
            });
        }

        console.log(`Parsed ${records.length} records from CSV`);

        // Get all dealerships and create a mapping
        const dealers = await Dealership.findAll();
        const dealerMap = new Map();
        
        // Map by name (case-insensitive)
        dealers.forEach(d => {
            dealerMap.set(d.name.toLowerCase(), d.id);
        });

        // Also try to map by partial match if exact match fails
        const dateMap = new Map(); // { date: [records] }

        // Process each record
        for (const record of records) {
            // Parse date
            const localDate = new Date(record['Date']);
            if (isNaN(localDate.getTime())) {
                console.warn(`Invalid date for record:`, record);
                continue;
            }

            const date = new Date(
                localDate.getTime() - localDate.getTimezoneOffset() * 60000
            ).toISOString().split('T')[0];

            // Find dealership ID
            let dealershipId = null;
            const dealerName = record['Dealership Name'];
            
            if (dealerName) {
                // Try exact match first (case-insensitive)
                dealershipId = dealerMap.get(dealerName.toLowerCase());
                
                // If not found, try partial match
                if (!dealershipId) {
                    for (const [name, id] of dealerMap.entries()) {
                        if (name.includes(dealerName.toLowerCase()) || 
                            dealerName.toLowerCase().includes(name)) {
                            dealershipId = id;
                            break;
                        }
                    }
                }
            }

            // Prepare inventory record
            const inventoryRecord = {
                first_seen: date,
                last_seen: date,
                type: record['Used'] || 'Used',
                year: parseInt(record['Year']) || 0,
                make: record['Make'] || '',
                model: record['Model'] || '',
                trim: record['Trim'] || null,
                mileage: parseInt(record['Mileage']) || 0,
                price: parseInt(record['Price']) || 0,
                url: record['URL'] || '',
                vin: record['Vin#'] || '',
                dealershipId: dealershipId
            };

            // Validate required fields
            if (!inventoryRecord.vin || !inventoryRecord.url) {
                console.warn('Skipping record missing VIN or URL:', inventoryRecord);
                continue;
            }

            if (!dateMap.has(date)) {
                dateMap.set(date, []);
            }
            dateMap.get(date).push(inventoryRecord);
        }

        console.log(`Processed records for ${dateMap.size} different dates`);

        // Sort dates
        const sortedDates = Array.from(dateMap.keys()).sort();

        // Fill missing dates
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

        console.log(`Total records after filling missing dates: ${filledData.length}`);

        // Insert in batches
        let totalImported = 0;
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

        console.log(`Successfully imported ${totalImported} records`);

        return res.json({
            success: true,
            message: `Successfully imported ${totalImported} inventory records`,
            recordsImported: totalImported
        });

    } catch (error) {
        console.error('Error processing inventory data:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to process inventory data',
            error: error.message
        });
    }
});

// Helper function to parse CSV string
const parseCSV = (csvString) => {
    return new Promise((resolve, reject) => {
        const records = [];
        const stream = Readable.from(csvString);
        
        stream.pipe(csv())
            .on('data', (data) => {
                records.push(data);
            })
            .on('end', () => {
                resolve(records);
            })
            .on('error', (error) => {
                reject(error);
            });
    });
};

// Helper function to process batch of records
const processBatch = async (batch) => {
    await Inventory.bulkCreate(batch, {
        updateOnDuplicate: ['last_seen', 'price', 'mileage']
    });
};

export default router;