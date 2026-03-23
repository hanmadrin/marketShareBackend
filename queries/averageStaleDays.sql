SELECT 
    COUNT(*) AS "count",
    make,
    model,
    MIN(DATEDIFF(last_seen, first_seen)) AS minimum_stale_days,
    MAX(DATEDIFF(last_seen, first_seen)) AS maximum_stale_days,
    AVG(DATEDIFF(last_seen, first_seen)) AS avg_stale_days
FROM `inventories` 
GROUP BY `make`, `model`  
HAVING COUNT(*) >= 2 
   AND MAX(last_seen) < (SELECT MAX(last_seen) FROM `inventories`)
ORDER BY `avg_stale_days` ASC;