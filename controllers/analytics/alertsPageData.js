import { QueryTypes } from 'sequelize';
import { Inventory, sequelize } from '../../configs/database.js'; // Assuming sequelize instance is exported


export const getTopSellingVehicles = async (filters) => {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;
    const competitorIds = competitors.filter(c => c.selected).map(c => c.id);
    const typeFilter = ['new', 'used'].includes(vehicleType) ? vehicleType : null;

    const typeCondition = typeFilter ? `AND type = ${sequelize.escape(typeFilter)}` : '';
    // make/model my stock,competitors,all
    const query = `
        SELECT 
            CONCAT(make, ' ', model) AS name,
            COUNT(*) AS total_count
        FROM inventories
        WHERE last_seen BETWEEN :startDate AND :endDate
            AND dealershipId IN (:competitorIds)
            ${typeCondition}
            AND last_seen < (
                SELECT MAX(last_seen) FROM inventories
            )
        GROUP BY make, model
        HAVING total_count > 2
        ORDER BY total_count DESC
        LIMIT 10
    `;

    const results = await sequelize.query(query, {
        replacements: { startDate, endDate, competitorIds },
        type: QueryTypes.SELECT
    });
    return results.map((r, idx) => ({ name: r.name, count: r.total_count, rank: idx + 1 }));

};
export const getTopSellingVehiclesRawData = async (filters,makeModel) => {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;

    const competitorIds = competitors
        .filter(c => c.selected)
        .map(c => c.id);

    const typeFilter = ['new', 'used'].includes(vehicleType) ? vehicleType : null;

    const typeCondition = typeFilter ? `AND i.type = ${sequelize.escape(typeFilter)}` : '';
    const typeCondition2 = typeFilter ? `AND type = ${sequelize.escape(typeFilter)}` : '';
    const makeModelCondition = makeModel ? `AND CONCAT(i.make, ' ', i.model) = ${sequelize.escape(makeModel)}` : '';

    const query = `
        WITH TopModels AS (
            SELECT 
                make,
                model
            FROM inventories
            WHERE last_seen BETWEEN :startDate AND :endDate
                AND dealershipId IN (:competitorIds)
                ${typeCondition}
                AND last_seen < (
                    SELECT MAX(last_seen) FROM inventories
                )
            GROUP BY make, model
            HAVING COUNT(*) > 2
            ORDER BY COUNT(*) DESC
            LIMIT 10
        )

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
        JOIN TopModels t
            ON i.make = t.make AND i.model = t.model
        JOIN dealerships d
            ON d.id = i.dealershipId
        WHERE
            i.last_seen BETWEEN :startDate AND :endDate
            AND i.dealershipId IN (:competitorIds)
            ${typeCondition}
            ${makeModelCondition}
            AND last_seen < (
                    SELECT MAX(last_seen) FROM inventories
                )
        ORDER BY i.make, i.model, i.last_seen DESC
    `;

    const results = await sequelize.query(query, {
        replacements: { startDate, endDate, competitorIds },
        type: QueryTypes.SELECT
    });

    return results;
};




export const getTopStockedVehicles = async (filters) => {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;
    const competitorIds = competitors.filter(c => c.selected).map(c => c.id);
    const typeFilter = ['new', 'used'].includes(vehicleType) ? vehicleType : null;

    const typeCondition = typeFilter ? `AND type = ${sequelize.escape(typeFilter)}` : '';
    // make/model my stock,competitors,all
    const query = `
        SELECT 
            CONCAT(make, ' ', model) AS name,
            COUNT(*) AS total_count
        FROM inventories
        WHERE first_seen BETWEEN :startDate AND :endDate
            AND dealershipId IN (:competitorIds)
            ${typeCondition}
            AND first_seen > (
                SELECT MIN(first_seen) FROM inventories
            )
        GROUP BY make, model
        HAVING total_count > 2
        ORDER BY total_count DESC
        LIMIT 10
    `;

    const results = await sequelize.query(query, {
        replacements: { startDate, endDate, competitorIds },
        type: QueryTypes.SELECT
    });
    return results.map((r, idx) => ({
        name: r.name,
        count: parseInt(r.total_count),
        rank: idx + 1
    }));

};
export const getTopStockedVehiclesRawData = async (filters, makeModel) => {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;

    const competitorIds = competitors
        .filter(c => c.selected)
        .map(c => c.id);

    if (!competitorIds.length) return [];

    const typeFilter = ['new', 'used'].includes(vehicleType)
        ? vehicleType
        : null;

    const typeCondition = typeFilter
        ? `AND i.type = ${sequelize.escape(typeFilter)}`
        : '';

    const typeCondition2 = typeFilter
        ? `AND type = ${sequelize.escape(typeFilter)}`
        : '';

    const query = `
        WITH TopModels AS (
            SELECT 
                make,
                model,
                COUNT(*) AS total_count
            FROM inventories
            WHERE first_seen BETWEEN :startDate AND :endDate
                AND dealershipId IN (:competitorIds)
                ${typeCondition2}
                AND first_seen > (
                    SELECT MIN(first_seen) FROM inventories
                )
            GROUP BY make, model
            HAVING total_count > 2
            ORDER BY total_count DESC
            LIMIT 10
        )

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
        ${
            makeModel
                ? ''
                : 'JOIN TopModels t ON i.make = t.make AND i.model = t.model'
        }
        JOIN dealerships d
            ON d.id = i.dealershipId
        WHERE
            i.first_seen BETWEEN :startDate AND :endDate
            AND i.dealershipId IN (:competitorIds)
            ${typeCondition}
            AND i.first_seen > (
                SELECT MIN(first_seen) FROM inventories
            )
            ${
                makeModel
                    ? `AND CONCAT(i.make, ' ', i.model) = ${sequelize.escape(makeModel)}`
                    : ''
            }
        ORDER BY i.first_seen DESC
    `;

    const results = await sequelize.query(query, {
        replacements: { startDate, endDate, competitorIds },
        type: QueryTypes.SELECT
    });

    return results;
};

// export const getTopStockedVehiclesRawData = async (filters,makeModel) => {
//     const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;

//     const competitorIds = competitors
//         .filter(c => c.selected)
//         .map(c => c.id);

//     const typeFilter = ['new', 'used'].includes(vehicleType) ? vehicleType : null;
//     const typeCondition = typeFilter ? `AND type = ${sequelize.escape(typeFilter)}` : '';
//     const makeModelCondition = makeModel ? `AND CONCAT(i.make, ' ', i.model) = ${sequelize.escape(makeModel)}` : '';

//     const query = `
//         WITH TopModels AS (
//             SELECT 
//                 make,
//                 model
//             FROM inventories
//             WHERE first_seen BETWEEN :startDate AND :endDate
//                 AND dealershipId IN (:competitorIds)
//                 ${typeCondition}
//                 AND first_seen > (
//                     SELECT MIN(first_seen) FROM inventories
//                 )
//             GROUP BY make, model
//             HAVING COUNT(*) > 2
//             ORDER BY COUNT(*) DESC
//         )

//         SELECT
//             i.first_seen AS Date,
//             d.name AS Dealership,
//             i.year AS Year,
//             CONCAT(i.make, ' ', i.model) AS MakeModel,
//             i.trim AS Trim,
//             i.mileage AS Mileage,
//             i.price AS Price,
//             i.url AS URL,
//             i.type AS Type,
//             i.vin AS VIN
//         FROM inventories i
//         JOIN TopModels t
//             ON i.make = t.make AND i.model = t.model
//         JOIN dealerships d
//             ON d.id = i.dealershipId
//         WHERE
//             i.first_seen BETWEEN :startDate AND :endDate
//             AND i.dealershipId IN (:competitorIds)
//             ${typeCondition}
//             ${makeModelCondition}
//         ORDER BY i.make, i.model, i.first_seen DESC
//     `;

//     const results = await sequelize.query(query, {
//         replacements: { startDate, endDate, competitorIds },
//         type: QueryTypes.SELECT
//     });

//     return results;
// };

export const getTopOutOfStockVehicles = async (filters) => {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;

    const competitorIds = competitors
        .filter(c => c.selected)
        .map(c => c.id);

    if (!competitorIds.length) return [];

    const typeFilter = ['new', 'used'].includes(vehicleType)
        ? `AND type = ${sequelize.escape(vehicleType)}`
        : '';

    const query = `
        WITH LatestInventory AS (
            -- Identifying vehicles currently in stock
            SELECT DISTINCT make, model
            FROM inventories i
            CROSS JOIN (
                SELECT MAX(first_seen) AS latest_date 
                FROM inventories 
                WHERE dealershipId IN (:competitorIds) ${typeFilter}
            ) AS current
            WHERE i.dealershipId IN (:competitorIds)
            AND i.first_seen <= current.latest_date
            AND (i.last_seen >= current.latest_date OR i.last_seen IS NULL)
            ${typeFilter}
        ),
        SoldCount AS (
            -- Your existing sold calculation logic
            SELECT 
                make, 
                model,
                CONCAT(make, ' ', model) AS name,
                COUNT(*) AS total_count
            FROM inventories
            WHERE last_seen BETWEEN :startDate AND :endDate
            AND dealershipId IN (:competitorIds)
            ${typeFilter}
            AND last_seen < (
                SELECT MAX(last_seen) FROM inventories WHERE dealershipId IN (:competitorIds) ${typeFilter}
            )
            GROUP BY make, model
        )
        SELECT s.*
        FROM SoldCount s
        LEFT JOIN LatestInventory l 
            ON s.make = l.make AND s.model = l.model
        WHERE l.make IS NULL -- Filters for vehicles NOT in the latest inventory
        ORDER BY s.total_count DESC
        LIMIT 10
    `;

    const results = await sequelize.query(query, {
        replacements: { startDate, endDate, competitorIds },
        type: QueryTypes.SELECT
    });


    return results.map((r, idx) => ({
        name: r.name,
        count: Number(r.total_count),
        rank: idx + 1
    }));
};
export const getTopOutOfStockVehiclesRawData = async (filters, makeModel) => {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;

    const competitorIds = competitors
        .filter(c => c.selected)
        .map(c => c.id);

    if (!competitorIds.length) return [];

    const typeFilter = ['new', 'used'].includes(vehicleType)
        ? `AND i.type = ${sequelize.escape(vehicleType)}`
        : '';

    const typeFilter2 = ['new', 'used'].includes(vehicleType)
        ? `AND type = ${sequelize.escape(vehicleType)}`
        : '';

    const query = `
        WITH LatestInventory AS (
            SELECT DISTINCT make, model
            FROM inventories i
            CROSS JOIN (
                SELECT MAX(first_seen) AS latest_date 
                FROM inventories 
                WHERE dealershipId IN (:competitorIds) ${typeFilter2}
            ) current
            WHERE i.dealershipId IN (:competitorIds)
            AND i.first_seen <= current.latest_date
            AND (i.last_seen >= current.latest_date OR i.last_seen IS NULL)
            ${typeFilter}
        ),
        SoldVehicles AS (
            SELECT *
            FROM inventories i
            WHERE i.last_seen BETWEEN :startDate AND :endDate
            AND i.dealershipId IN (:competitorIds)
            ${typeFilter}
            AND i.last_seen < (
                SELECT MAX(last_seen) 
                FROM inventories 
                WHERE dealershipId IN (:competitorIds) ${typeFilter2}
            )
        ),
        OutOfStockVehicles AS (
            SELECT sv.*
            FROM SoldVehicles sv
            LEFT JOIN LatestInventory li
                ON sv.make = li.make AND sv.model = li.model
            WHERE li.make IS NULL
        ),
        TopModels AS (
            SELECT make, model
            FROM OutOfStockVehicles
            GROUP BY make, model
            ORDER BY COUNT(*) DESC
            LIMIT 10
        )
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
        FROM OutOfStockVehicles i
        ${
            makeModel
                ? ''
                : 'JOIN TopModels tm ON i.make = tm.make AND i.model = tm.model'
        }
        JOIN dealerships d 
            ON d.id = i.dealershipId
        ${
            makeModel
                ? `WHERE CONCAT(i.make, ' ', i.model) = ${sequelize.escape(makeModel)}`
                : ''
        }
        ORDER BY i.last_seen DESC
    `;

    const results = await sequelize.query(query, {
        replacements: { startDate, endDate, competitorIds },
        type: QueryTypes.SELECT
    });

    return results;
};

// export const getTopOutOfStockVehiclesRawData = async (filters,makeModel) => {
//     const { competitors, dateRange: { startDate, endDate }, vehicleType } = filters;

//     const competitorIds = competitors
//         .filter(c => c.selected)
//         .map(c => c.id);

//     if (!competitorIds.length) return [];

//     const typeFilter = ['new', 'used'].includes(vehicleType)
//         ? `AND i.type = ${sequelize.escape(vehicleType)}`
//         : '';

//     const typeFilter2 = ['new', 'used'].includes(vehicleType)
//         ? `AND type = ${sequelize.escape(vehicleType)}`
//         : '';
//     const makeModelCondition = makeModel ? `AND CONCAT(i.make, ' ', i.model) = ${sequelize.escape(makeModel)}` : '';

//     const query = `
//         WITH LatestInventory AS (
//             SELECT DISTINCT make, model
//             FROM inventories i
//             CROSS JOIN (
//                 SELECT MAX(first_seen) AS latest_date 
//                 FROM inventories 
//                 WHERE dealershipId IN (:competitorIds) ${typeFilter}
//             ) AS current
//             WHERE i.dealershipId IN (:competitorIds)
//             AND i.first_seen <= current.latest_date
//             AND (i.last_seen >= current.latest_date OR i.last_seen IS NULL)
//             ${typeFilter}
//         ),
//         SoldVehicles AS (
//             SELECT *
//             FROM inventories
//             WHERE last_seen BETWEEN :startDate AND :endDate
//             AND dealershipId IN (:competitorIds)
//             ${typeFilter}
//             AND last_seen < (
//                 SELECT MAX(last_seen) 
//                 FROM inventories 
//                 WHERE dealershipId IN (:competitorIds) ${typeFilter}
//             )
//         ),
//         TopModels AS (
//             SELECT make, model
//             FROM SoldVehicles
//             GROUP BY make, model
//             ORDER BY COUNT(*) DESC
//         )
//         SELECT 
//             i.last_seen AS Date,
//             d.name AS Dealership,
//             i.year AS Year,
//             CONCAT(i.make, ' ', i.model) AS MakeModel,
//             i.trim AS Trim,
//             i.mileage AS Mileage,
//             i.price AS Price,
//             i.url AS URL,
//             i.type AS Type,
//             i.vin AS VIN
//         FROM SoldVehicles i
//         JOIN TopModels t 
//             ON i.make = t.make AND i.model = t.model
//         LEFT JOIN LatestInventory l 
//             ON i.make = l.make AND i.model = l.model
//         JOIN dealerships d 
//             ON d.id = i.dealershipId
//         WHERE l.make IS NULL
//         ORDER BY i.make, i.model, i.last_seen DESC
//     `;

//     const results = await sequelize.query(query, {
//         replacements: { startDate, endDate, competitorIds },
//         type: QueryTypes.SELECT
//     });

//     return results;
// };