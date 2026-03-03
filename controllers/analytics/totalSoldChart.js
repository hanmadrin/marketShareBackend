// /**
//  * Calculates the total sold chart data by comparing vehicle identifiers day-over-day.
//  * @param {Object} filters - res.locals.filters containing dateRange and competitors.
//  * @returns {Promise<Array<{date: string, value: number}>>}
//  */
// import { Op, } from 'sequelize';
// import { Inventory } from '../../configs/database.js';
// import { format } from 'date-fns';

// async function getTotalSoldChart(filters) {
//     function identifierForRow(row) {
//         if (row.vin && row.vin.trim()) return `vin:${row.vin.trim().toLowerCase()}`;
//         if (row.url && row.url.trim()) return `url:${row.url.trim().toLowerCase()}`;
//         return `fm:${row.make || ''}|${row.model || ''}|${row.trim || ''}`.toLowerCase();
//     }
//     function friendlyLabel(date) {
//         return format(new Date(date), 'MMM dd');
//     }
//     function toDayString(dt) {
//         return format(new Date(dt), 'yyyy-MM-dd');
//     }
//     const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;
//     const competitorIds = competitors.filter(c => c.selected).map(c => c.id);
//     const typeFilter = ['new', 'used'].includes(vehicleType) ? vehicleType : null;

//     const baseWhere = {
//         date: { [Op.between]: [startDate, endDate] },
//         dealershipId: { [Op.in]: competitorIds },
//         ...(typeFilter && { type: typeFilter }),
//     };

//     // 1. Get all unique dates in the range
//     const dayRows = await Inventory.findAll({
//         where: baseWhere,
//         attributes: [['date', 'day']],
//         group: ['date'],
//         order: [['date', 'ASC']],
//         raw: true,
//     });

//     const sortedDays = dayRows.map(r => String(r.day));
//     if (sortedDays.length === 0) return [];

//     // 2. Fetch all rows once to minimize DB roundtrips
//     const allRows = await Inventory.findAll({
//         where: baseWhere,
//         attributes: ['date', 'vin', 'url', 'make', 'model', 'trim', 'dealershipId'],
//         raw: true,
//     });

//     // 3. Group identifiers by day
//     const idsByDay = new Map();
//     for (const r of allRows) {
//         const dStr = r.date instanceof Date ? format(r.date, 'yyyy-MM-dd') : toDayString(r.date);
//         if (!idsByDay.has(dStr)) idsByDay.set(dStr, new Set());
//         idsByDay.get(dStr).add(identifierForRow(r));
//     }

//     // 4. Compare Day(i) vs Day(i-1) to determine sold count
//     return sortedDays.map((day, idx) => {
//         const label = friendlyLabel(day);
//         if (idx === 0) return { date: label, value: 0 };

//         const currentSet = idsByDay.get(day) || new Set();
//         const prevSet = idsByDay.get(sortedDays[idx - 1]) || new Set();

//         let soldCount = 0;
//         for (const id of prevSet) {
//             if (!currentSet.has(id)) soldCount++;
//         }

//         return { date: label, value: soldCount };
//     });
// }

// export default getTotalSoldChart;



import { QueryTypes } from 'sequelize';
import { Inventory, sequelize } from '../../configs/database.js'; // Assuming sequelize instance is exported
import { format } from 'date-fns';

async function getTotalSoldChart(filters) {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;
    const competitorIds = competitors.filter(c => c.selected).map(c => c.id);
    const typeFilter = ['new', 'used'].includes(vehicleType) ? `AND type = ${sequelize.escape(vehicleType)}` : '';

    const query = `
    WITH ScrapeDates AS (
        -- Get all unique dates where we actually have data
        SELECT DISTINCT date 
        FROM Inventories 
        WHERE date BETWEEN :startDate AND :endDate
          AND dealershipId IN (:competitorIds)
    ),
    NextScrape AS (
        -- Map every date to the very next date that has data
        SELECT date, 
               LEAD(date) OVER (ORDER BY date) AS next_actual_scrape_date
        FROM ScrapeDates
    ),
    VehicleSightings AS (
        -- Get identifiers and their next appearance
        SELECT 
            date,
            LOWER(COALESCE(
                NULLIF(TRIM(vin), ''), 
                NULLIF(TRIM(url), ''), 
                CONCAT('fm:', COALESCE(make, ''), '|', COALESCE(model, ''), '|', COALESCE(trim, ''))
            )) AS identifier,
            LEAD(date) OVER (PARTITION BY 
                LOWER(COALESCE(NULLIF(TRIM(vin), ''), NULLIF(TRIM(url), ''), CONCAT('fm:', make, '|', model, '|', trim))) 
                ORDER BY date
            ) AS next_seen_date
        FROM Inventories
        WHERE date BETWEEN :startDate AND :endDate
          AND dealershipId IN (:competitorIds)
          ${typeFilter}
    )
    -- A vehicle is sold if it was present on 'date' but 
    -- missing on the 'next_actual_scrape_date'
    SELECT 
        ns.next_actual_scrape_date AS soldDate, 
        COUNT(*) AS soldCount
    FROM VehicleSightings vs
    JOIN NextScrape ns ON vs.date = ns.date
    WHERE ns.next_actual_scrape_date IS NOT NULL 
      AND (vs.next_seen_date IS NULL OR vs.next_seen_date > ns.next_actual_scrape_date)
    GROUP BY soldDate
    ORDER BY soldDate ASC;
`;

    const results = await sequelize.query(query, {
        replacements: { startDate, endDate, competitorIds },
        type: QueryTypes.SELECT,
        raw: true,
        
    });

    // Format for the chart frontend
    return results.map(row => ({
        date: format(new Date(row.soldDate), 'MMM dd'),
        value: parseInt(row.soldCount, 10)
    }));
}

export default getTotalSoldChart;