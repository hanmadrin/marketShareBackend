import { Op, fn, col, literal } from 'sequelize';
import { Inventory, sequelize } from '../../configs/database.js'; // Adjust path

const inventoryAdded = async (dealershipId, baseWhere) => {
    const results = await Inventory.findAll({
        where: {
            ...baseWhere,
            // Check if this VIN existed for the same dealer on the previous day
            [Op.and]: [
                literal(`NOT EXISTS (
                    SELECT 1 FROM Inventories AS prev 
                    WHERE prev.vin = Inventory.vin 
                    AND prev.dealershipId = Inventory.dealershipId 
                    AND prev.date = DATE_SUB(Inventory.date, INTERVAL 1 DAY)
                )`)
            ]
        },
        attributes: [
            [fn('CONCAT', col('make'), ' ', col('model')), 'makeModel'],
            'dealershipId',
            [fn('COUNT', col('id')), 'count']
        ],
        group: ['makeModel', 'dealershipId'],
        raw: true
    });

    const totals = { my: 0, all: 0, competitors: 0 };
    const grouped = results.reduce((acc, curr) => {
        const { makeModel, dealershipId: rowId, count } = curr;
        const numCount = parseInt(count, 10);

        if (!acc[makeModel]) {
            acc[makeModel] = { makeModel, counts: { my: 0, all: 0, competitors: 0 } };
        }

        if (rowId === dealershipId) {
            acc[makeModel].counts.my += numCount;
            totals.my += numCount;
        } else {
            acc[makeModel].counts.competitors += numCount;
            totals.competitors += numCount;
        }
        
        acc[makeModel].counts.all += numCount;
        totals.all += numCount;

        return acc;
    }, {});

    return { 
        items: Object.values(grouped), 
        total: totals 
    };
};

export default inventoryAdded;