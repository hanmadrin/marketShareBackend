import { Op, fn, col, literal } from 'sequelize';
import { Inventory, sequelize } from '../../configs/database.js'; // Adjust path
import { QueryTypes } from 'sequelize';

export const getInventory = async (filters, user) => {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;
    const competitorIds = competitors.filter(c => c.selected).map(c => c.id);
    const typeFilter = ['new', 'used'].includes(vehicleType) ? vehicleType : null;

    const typeCondition = typeFilter ? `AND type = ${sequelize.escape(typeFilter)}` : '';
    const dealershipId = user.dealershipId;
    // make/model my stock,competitors,all
    const query = `
    SELECT 
        CONCAT(i.make, ' ', i.model) AS name,

        SUM(CASE 
                WHEN i.dealershipId = :dealershipId
                THEN 1 ELSE 0 
            END) AS my_count,

        SUM(CASE 
                WHEN i.dealershipId IN (:competitorIds) AND i.dealershipId != :dealershipId
                THEN 1 ELSE 0 
            END) AS competitor_count,

        COUNT(*) AS total_count

    FROM (
        SELECT DISTINCT DATE(first_seen) AS date_series
        FROM inventories
        -- WHERE first_seen BETWEEN :startDate AND :endDate
        WHERE first_seen = (SELECT MAX(first_seen) FROM inventories WHERE dealershipId IN (:competitorIds) ${typeCondition} )

    ) AS calendar

    JOIN inventories i
        ON i.first_seen <= calendar.date_series
        AND (i.last_seen >= calendar.date_series)

    WHERE 1=1
        ${typeCondition}
        AND  i.dealershipId IN (:competitorIds)
    GROUP BY i.make, i.model
    ORDER BY total_count DESC;
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
export const getInventoryRawData = async (filters,makeModel) => {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;
    const competitorIds = competitors.filter(c => c.selected).map(c => c.id);
    const typeFilter = ['new', 'used'].includes(vehicleType) ? vehicleType : null;

    const typeCondition = typeFilter ? `AND type = ${sequelize.escape(typeFilter)}` : '';
    // all fields
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

        FROM (
            SELECT DISTINCT DATE(first_seen) AS date_series
            FROM inventories
            WHERE first_seen = (
                SELECT MAX(first_seen) 
                FROM inventories 
                WHERE dealershipId IN (:competitorIds) ${typeCondition}
            )
        ) AS calendar

        JOIN inventories i
            ON i.first_seen <= calendar.date_series
            AND i.last_seen >= calendar.date_series

        JOIN dealerships d
            ON d.id = i.dealershipId

        WHERE 1=1
            ${typeCondition}
            ${makeModelCondition}
            AND i.dealershipId IN (:competitorIds)


        ORDER BY i.make, i.model;
    `;

    const results = await sequelize.query(query, {
        replacements: { startDate, endDate, competitorIds },
        type: QueryTypes.SELECT
    });

    return results;

}
export const getInventoryDate = async (filters) => {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;
    const competitorIds = competitors.filter(c => c.selected).map(c => c.id);
    const typeFilter = ['new', 'used'].includes(vehicleType) ? vehicleType : null;

    const typeCondition = typeFilter ? `AND type = ${sequelize.escape(typeFilter)}` : '';
    // make/model my stock,competitors,all
    const query = `
        SELECT DATE_FORMAT(MAX(first_seen), '%M %d,%Y') AS latest_date FROM inventories WHERE dealershipId IN (:competitorIds) ${typeCondition} 
    `;

    const results = await sequelize.query(query, {
        replacements: { competitorIds },
        type: QueryTypes.SELECT
    });
    return results[0].latest_date;
}

export const getInventoryAverage = async (filters) => {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;
    const competitorIds = competitors.filter(c => c.selected).map(c => c.id);
    const typeFilter = ['new', 'used'].includes(vehicleType) ? vehicleType : null;

    const typeCondition = typeFilter ? `AND type = ${sequelize.escape(typeFilter)}` : '';
    // make/model my stock,competitors,all
    const query = `
        SELECT 
            FLOOR(AVG(i.price)) AS price,
            ROUND(AVG(i.year), 1) AS year,
            FLOOR(AVG(i.mileage)) AS mileage,
            i.type
        FROM (
            -- Logic to get the most recent date in the dataset
            SELECT DISTINCT DATE(first_seen) AS date_series
            FROM inventories
            WHERE first_seen = (SELECT MAX(first_seen) FROM inventories WHERE dealershipId IN (:competitorIds) ${typeCondition})
        ) AS calendar
        JOIN inventories i
            ON i.first_seen <= calendar.date_series
            AND (i.last_seen >= calendar.date_series)
        WHERE 
            i.dealershipId IN (:competitorIds)
            ${typeCondition}
        GROUP BY i.type

        UNION ALL

        -- "Both" category row
        SELECT 
            FLOOR(AVG(i.price)) AS price,
            ROUND(AVG(i.year), 1) AS year,
            FLOOR(AVG(i.mileage)) AS mileage,
            'both' AS type
        FROM (
            SELECT DISTINCT DATE(first_seen) AS date_series
            FROM inventories
            WHERE first_seen = (SELECT MAX(first_seen) FROM inventories WHERE dealershipId IN (:competitorIds) ${typeCondition})
        ) AS calendar
        JOIN inventories i
            ON i.first_seen <= calendar.date_series
            AND (i.last_seen >= calendar.date_series)
        WHERE 
            i.dealershipId IN (:competitorIds)
            ${typeCondition};
    `;

    const results = await sequelize.query(query, {
        replacements: { competitorIds },
        type: QueryTypes.SELECT
    });
    const averages = {};
    results.forEach(r => {
        averages[r.type] = {
            price: Number(r.price),
            year: Number(r.year),
            mileage: Number(r.mileage)
        };
    });
    return averages;

}



export default getInventory;