SELECT 
    last_seen AS "sale_date",
    COUNT(*) AS "daily_sold_count"
FROM `inventories`
WHERE last_seen < (SELECT MAX(last_seen) FROM `inventories`) 
  AND `dealershipId` = 5
GROUP BY last_seen
ORDER BY last_seen DESC;