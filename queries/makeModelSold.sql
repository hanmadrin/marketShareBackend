SELECT 
    CONCAT(make, ' ', model) AS makeModel,
    COUNT(*) AS count,
    SUM(COUNT(*)) OVER() AS total
FROM inventories
WHERE last_seen < (SELECT MAX(last_seen) FROM inventories)
    AND dealershipId = 5
GROUP BY make, model
ORDER BY count DESC;