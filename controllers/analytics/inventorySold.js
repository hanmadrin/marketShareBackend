import { Op, fn, col, literal } from 'sequelize';
import { Inventory } from '../../configs/database.js';

const inventorySold = async (dealershipId, baseWhere) => {
    const results = await Inventory.findAll({
        attributes: [
            [fn('CONCAT', col('make'), ' ', col('model')), 'makeModel'],
            // Aggregate counts directly in SQL
            [fn('SUM', literal(`CASE WHEN dealershipId = ${dealershipId} THEN 1 ELSE 0 END`)), 'my'],
            [fn('SUM', literal(`CASE WHEN dealershipId != ${dealershipId} THEN 1 ELSE 0 END`)), 'competitors'],
            [fn('COUNT', col('*')), 'all']
        ],
        where: {
            ...baseWhere,
            [Op.and]: [
                literal(`NOT EXISTS (
                    SELECT 1 FROM Inventories AS NextDay 
                    WHERE NextDay.vin = Inventory.vin 
                    AND NextDay.dealershipId = Inventory.dealershipId
                    AND NextDay.date = DATE_ADD(Inventory.date, INTERVAL 1 DAY)
                )`)
            ]
        },
        group: ['makeModel'], // Group by the concatenated string
        raw: true,
     Neptune: true
    });

    // Format the response to match your expected structure
    const items = results.map(row => ({
        makeModel: row.makeModel,
        counts: {
            my: parseInt(row.my, 10),
            competitors: parseInt(row.competitors, 10),
            all: parseInt(row.all, 10)
        }
    }));

    // Calculate totals from the grouped results
    const total = items.reduce((acc, item) => {
        acc.my += item.counts.my;
        acc.competitors += item.counts.competitors;
        acc.all += item.counts.all;
        return acc;
    }, { my: 0, competitors: 0, all: 0 });

    return { items, total };
};

export default inventorySold;