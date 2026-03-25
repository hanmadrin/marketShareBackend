import { Op, fn, col, literal } from 'sequelize';
import { Inventory, sequelize } from '../../configs/database.js'; // Adjust path
import { QueryTypes } from 'sequelize';

export const getInventorySold = async (filters, user) => {
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
        WHERE last_seen BETWEEN :startDate AND :endDate
            AND dealershipId IN (:competitorIds)
            ${typeCondition}
            AND last_seen < (
                SELECT MAX(last_seen) FROM inventories WHERE dealershipId IN (:competitorIds) ${typeCondition}
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
export const getInventorySoldRawData = async (filters,makeModel) => {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;
    const competitorIds = competitors.filter(c => c.selected).map(c => c.id);
    const typeFilter = ['new', 'used'].includes(vehicleType) ? vehicleType : null;

    const typeCondition = typeFilter ? `AND i.type = ${sequelize.escape(typeFilter)}` : '';
    const makeModelCondition = makeModel ? `AND CONCAT(i.make, ' ', i.model) = ${sequelize.escape(makeModel)}` : '';

    const query = `
            SELECT 
                i.last_seen AS Date,
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
                DATE(i.last_seen) BETWEEN DATE(:startDate) AND DATE(:endDate)
                AND i.dealershipId IN (:competitorIds)
                ${typeCondition}
                ${makeModelCondition}
                AND DATE(i.last_seen) < (
                    SELECT DATE(MAX(last_seen)) 
                    FROM inventories 
                    WHERE dealershipId IN (:competitorIds) ${typeCondition}
                )
            ORDER BY i.make, i.model, i.last_seen DESC;
    `;

    const results = await sequelize.query(query, {
        replacements: { startDate, endDate, competitorIds },
        type: QueryTypes.SELECT
    });

    return results;
};
export const getAverageSold = async (filters, user) => {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;
    const competitorIds = competitors.filter(c => c.selected).map(c => c.id);
    const typeFilter = ['new', 'used'].includes(vehicleType) ? vehicleType : null;

    const typeCondition = typeFilter ? `AND type = ${sequelize.escape(typeFilter)}` : '';
    const dealershipId = user.dealershipId;
    // make/model my stock,competitors,all
    const query = `
        SELECT 
            FLOOR(AVG(price)) AS price,
            ROUND(AVG(year),1) AS year,
            FLOOR(AVG(mileage)) AS mileage,
            type
        FROM inventories
        WHERE 
            last_seen < (SELECT MAX(last_seen) FROM inventories WHERE dealershipId IN (:competitorIds) ${typeCondition})
            AND dealershipId IN (:competitorIds)
            ${typeCondition}
            AND last_seen BETWEEN :startDate AND :endDate
        GROUP BY type

        UNION ALL

        SELECT 
            FLOOR(AVG(price)) AS price,
            ROUND(AVG(year),1) AS year,
            FLOOR(AVG(mileage)) AS mileage,
            'both' AS type
        FROM inventories
        WHERE 
            last_seen < (SELECT MAX(last_seen) FROM inventories WHERE dealershipId IN (:competitorIds) ${typeCondition})
            AND dealershipId IN (:competitorIds)
            ${typeCondition}
            AND last_seen BETWEEN :startDate AND :endDate
    `;

    const results = await sequelize.query(query, {
        replacements: { startDate, endDate, competitorIds, dealershipId },
        type: QueryTypes.SELECT
    });
    
    const averages = {};
    results.forEach(r => {
        averages[r.type] = {
            price: Number(r.price),
            year: Number(r.year),
            mileage: Number(r.mileage)
        };
    } );
    return averages;

};

export default getInventorySold;