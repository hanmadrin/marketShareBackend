import { Op, fn, col, literal } from 'sequelize';
import { Inventory, sequelize } from '../../configs/database.js'; // Adjust path
import { QueryTypes } from 'sequelize';
import {getGraphColor} from './colors.js';

export const getSalesByDealershipData = async (filters) => {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;

    // 1. Filter selected competitors and build dynamic column SQL
    const dealershipColumns = competitors.filter(c => c.selected).map(c =>
        `SUM(CASE WHEN dealershipId = ${sequelize.escape(c.id)} THEN 1 ELSE 0 END) AS ${sequelize.escape(c.name)}`
    ).join(', ');

    const competitorIds = competitors.filter(c => c.selected).map(c => c.id);
    const typeCondition = ['new', 'used'].includes(vehicleType)
    ? `AND type = ${sequelize.escape(vehicleType)}`
    : '';

    // 2. Dynamic Query grouped by Date
    const query = `
        SELECT 
            DATE_FORMAT(DATE(last_seen), '%b %d') AS date,
            ${dealershipColumns},
            COUNT(*) AS total_daily_sold
        FROM inventories
        WHERE last_seen BETWEEN :startDate AND :endDate
            AND dealershipId IN (:competitorIds)
            ${typeCondition}
            AND last_seen < (SELECT MAX(last_seen) FROM inventories WHERE dealershipId IN (:competitorIds) ${typeCondition})
        GROUP BY DATE(last_seen)
        ORDER BY date ASC
    `;

    const results = await sequelize.query(query, {
        replacements: { startDate, endDate, competitorIds },
        type: QueryTypes.SELECT
    });

    const names = competitors.filter(c => c.selected).map(c => c.name);
    return results.map(row => {
        const date = row.date;
        const dailySold = {};
        // names.map(name => ({ [`${name}`]: Number(row[name].name) || 0 }));
        names.forEach(name => {
            dailySold[name] = Number(row[name]) || 0;
        });
        return { date, ...dailySold };
    });
};

export const getMarketShareByDealership = async (filters,user) => {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;
    const myDealershipId = user.dealershipId;
    const competitorIds = competitors.filter(c => c.selected).map(c => c.id);
    const typeCondition = ['new', 'used'].includes(vehicleType)
        ? `AND i.type = ${sequelize.escape(vehicleType)}`
        : '';

    const query = `
        WITH SalesData AS (
            SELECT 
                d.name AS dealership,
                dealershipId,
                SUM(CASE WHEN type = 'used' THEN 1 ELSE 0 END) AS used_sold,
                SUM(CASE WHEN type = 'new' THEN 1 ELSE 0 END) AS new_sold,
                COUNT(*) AS both_sold,
                -- Calculate the number of distinct days in the period for the trend
                -- DATEDIFF(MAX(last_seen), MIN(first_seen))  AS days_active
                DATEDIFF(:endDate, :startDate) + 1 AS days_active
            FROM inventories i
            JOIN dealerships d ON i.dealershipId = d.id
            WHERE i.last_seen BETWEEN :startDate AND :endDate
                AND i.dealershipId IN (:competitorIds)
                AND i.last_seen < (SELECT MAX(last_seen) FROM inventories)
                ${typeCondition}
            GROUP BY d.name, i.dealershipId
        )
        SELECT 
            dealership,
            dealershipId,
            used_sold,
            new_sold,
            both_sold,
            days_active,
            ROUND(100.0 * CAST(both_sold AS FLOAT) / CAST(SUM(both_sold) OVER () AS FLOAT)) AS marketShare,
            ROUND(((CAST(used_sold AS FLOAT) / NULLIF(days_active, 0)) * 30)) AS "used_mo_trend",
            ROUND(((CAST(new_sold AS FLOAT) / NULLIF(days_active, 0)) * 30)) AS "new_mo_trend"
        FROM SalesData
        ORDER BY 
            CASE WHEN dealershipId = :myDealershipId THEN 0 ELSE 1 END, 
            both_sold DESC;
    `;
    // color
    // "#755df3"
    // id
    // : 
    // "5"
    // marketSharePercent
    // : 
    // 5
    // name
    // : 
    // "Matthews Motor Company"
    // usedSold
    // : 
    // 190
    // usedSoldMoTrend
    // : 
    // 5
    const results = await sequelize.query(query, {
        replacements: { startDate, endDate, competitorIds , myDealershipId },
        type: QueryTypes.SELECT
    });
    return results.map((r) => {
        // console.log(r)
        return {
            name: r.dealership,
            daysActive: r.days_active,
            usedSold: r.used_sold,
            newSold: r.new_sold,
            marketSharePercent: r.marketShare,
            usedSoldMoTrend: r.used_mo_trend,
            newSoldMoTrend: r.new_mo_trend,
            color: getGraphColor(r.dealershipId),
            id: r.dealershipId
        };
    });

}   