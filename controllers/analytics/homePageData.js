import { QueryTypes } from 'sequelize';
import { Inventory, sequelize } from '../../configs/database.js'; // Assuming sequelize instance is exported

export const getSoldGraphData = async (filters) => {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;
    
    // Map selected competitor IDs
    const competitorIds = competitors.filter(c => c.selected).map(c => c.id);
    
    // Dynamic filter for vehicle type
    const typeFilter = ['new', 'used'].includes(vehicleType) 
        ? `AND type = ${sequelize.escape(vehicleType)}` 
        : '';

    const query = `
        SELECT 
            DATE_FORMAT(last_seen, '%b %d') AS "sale_date",
            COUNT(*) AS "daily_sold_count"
        FROM inventories
        WHERE last_seen BETWEEN :startDate AND :endDate
            AND dealershipId IN (:competitorIds)
            ${typeFilter}
            AND last_seen < (SELECT MAX(last_seen) FROM inventories)
        GROUP BY last_seen
        ORDER BY last_seen ASC;
    `;

    const results = await sequelize.query(query, {
        replacements: { startDate, endDate, competitorIds },
        type: QueryTypes.SELECT,
        raw: true,
    });

    return results.map(r => ({ date: r.sale_date, value: parseInt(r.daily_sold_count) }));
}

export const getNewStockGraphdata = async (filters) => {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;
    
    const competitorIds = competitors.filter(c => c.selected).map(c => c.id);
    
    // Dynamic filter for vehicle type
    const typeFilter = ['new', 'used'].includes(vehicleType) 
        ? `AND type = ${sequelize.escape(vehicleType)}` 
        : '';

    const query = `
        SELECT 
            DATE_FORMAT(first_seen, '%b %d') AS "entry_date",
            COUNT(*) AS "daily_inventory_count"
        FROM inventories
        WHERE first_seen BETWEEN :startDate AND :endDate
            AND dealershipId IN (:competitorIds)
            ${typeFilter}
            AND first_seen > (SELECT MIN(first_seen) FROM inventories)
            -- AND first_seen < (SELECT MAX(first_seen) FROM inventories)
        GROUP BY entry_date
        ORDER BY first_seen ASC;
    `;

    const results = await sequelize.query(query, {
        replacements: { startDate, endDate, competitorIds },
        type: QueryTypes.SELECT,
        raw: true,
    });

    return results.map(r => ({ 
        date: r.entry_date, 
        value: parseInt(r.daily_inventory_count) 
    }));
}

export const getInventoryGraphData = async (filters) => {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;
    
    const competitorIds = competitors.filter(c => c.selected).map(c => c.id);
    
    // Dynamic filter for vehicle type
    const typeFilter = ['new', 'used'].includes(vehicleType) 
        ? `AND type = ${sequelize.escape(vehicleType)}` 
        : '';

    const query = `
        SELECT 
            DATE_FORMAT(calendar.date_series, '%b %d') AS "entry_date",
            (
                SELECT COUNT(*) 
                FROM inventories i
                WHERE i.dealershipId IN (:competitorIds)
                ${typeFilter}
                AND i.first_seen <= calendar.date_series
                AND (i.last_seen >= calendar.date_series OR i.last_seen IS NULL)
            ) AS "daily_inventory_count"
        FROM (
            SELECT DISTINCT DATE(first_seen) AS date_series 
            FROM inventories 
            WHERE first_seen BETWEEN :startDate AND :endDate
            AND first_seen < (SELECT MAX(first_seen) FROM inventories)
        ) AS calendar
        ORDER BY calendar.date_series ASC;
    `;

    const results = await sequelize.query(query, {
        replacements: { startDate, endDate, competitorIds },
        type: QueryTypes.SELECT,
        raw: true,
    });

    return results.map(r => ({ 
        date: r.entry_date, 
        value: parseInt(r.daily_inventory_count) 
    }));
}


