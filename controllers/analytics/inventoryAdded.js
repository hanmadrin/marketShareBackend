import { Op, fn, col, literal } from 'sequelize';
import { Inventory, sequelize } from '../../configs/database.js'; // Adjust path
import { QueryTypes } from 'sequelize';

const getInventoryAdded = async (filters, user) => {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;
    const competitorIds = competitors.filter(c => c.selected).map(c => c.id);
    const typeFilter = ['new', 'used'].includes(vehicleType) ? vehicleType : null;

    const typeCondition = typeFilter ? `AND type = ${sequelize.escape(typeFilter)}` : '';
    const dealershipId = user.dealershipId;
    // make/model my stock,competitors,all
    const query = `
        SELECT 
            CONCAT(make, ' ', model) AS name,
            SUM(CASE WHEN dealershipId = :dealershipId THEN 1 ELSE 0 END) AS my_count,
            SUM(CASE WHEN dealershipId IN (:competitorIds) 
                    AND dealershipId != :dealershipId THEN 1 ELSE 0 END) AS competitor_count,
            COUNT(*) AS total_count
        FROM inventories
        WHERE first_seen BETWEEN :startDate AND :endDate
            AND dealershipId IN (:competitorIds)
            ${typeCondition}
            AND first_seen > (
                SELECT MIN(first_seen) FROM inventories
            )
        GROUP BY make, model
        ORDER BY total_count DESC
    `;

    const results = await sequelize.query(query, {
        replacements: { startDate, endDate, competitorIds, dealershipId },
        type: QueryTypes.SELECT
    });
    const totals = { my: 0, competitors: 0, all: 0 };

    const items = results.map(r => {
        // 2. Cast to Number to avoid string concatenation errors
        const my = Number(r.my_count);
        const comp = Number(r.competitor_count);
        const all = Number(r.total_count);

        totals.my += my;
        totals.competitors += comp;
        totals.all += all;

        return { 
            makeModel: r.name, 
            counts: { my, competitors: comp, all } 
        };
    });

    return { items, total: totals };
    
};
export const getInventoryAddedRawData = async (filters,makeModel) => {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;
    const competitorIds = competitors.filter(c => c.selected).map(c => c.id);
    const typeFilter = ['new', 'used'].includes(vehicleType) ? vehicleType : null;

    const typeCondition = typeFilter ? `AND i.type = ${sequelize.escape(typeFilter)}` : '';
    const makeModelCondition = makeModel ? `AND CONCAT(i.make, ' ', i.model) = ${sequelize.escape(makeModel)}` : '';

    const query = `
        SELECT 
            i.first_seen AS Date,
            d.name AS Dealership,
            i.year AS Year,
            CONCAT(i.make, ' ', i.model) AS MakeModel,
            i.trim AS Trim,
            i.mileage AS Mileage,
            i.price AS Price,
            i.url AS URL,
            i.type AS Type,
            i.vin AS VIN
        FROM inventories i
        JOIN dealerships d
            ON d.id = i.dealershipId
        WHERE 
            i.first_seen BETWEEN :startDate AND :endDate
            AND i.dealershipId IN (:competitorIds)
            ${typeCondition}
            ${makeModelCondition}
            AND i.first_seen > (
                SELECT MIN(first_seen) FROM inventories
            )
        ORDER BY i.make, i.model, i.first_seen
    `;

    const results = await sequelize.query(query, {
        replacements: { startDate, endDate, competitorIds },
        type: QueryTypes.SELECT
    });

    return results;
};
export default getInventoryAdded;