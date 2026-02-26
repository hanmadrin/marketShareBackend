import express, { json } from 'express';
import { Op } from 'sequelize';
import { format, parseISO, startOfDay, endOfDay, subDays } from 'date-fns';
import { sequelize, Inventory, Dealership } from '../configs/database.js';

const router = express.Router();

// OPTIMIZATION 1: High-performance date stringifier. Bypasses `new Date()` overhead.
function toDayStringFast(dt) {
  if (!dt) return '';
  if (typeof dt === 'string') return dt.substring(0, 10);
  if (dt instanceof Date) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return new Date(dt).toISOString().substring(0, 10);
}

// Formats "YYYY-MM-DD" back to "MMM dd" quickly
function friendlyLabelFast(dayStr) {
  if (!dayStr) return '';
  const parts = dayStr.split('-');
  if (parts.length !== 3) return dayStr;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return format(d, 'MMM dd');
}

// Identifier without repetitive trim calls
function identifierForRow(row) {
  if (row.vin) {
    const v = row.vin.trim();
    if (v) return `v:${v}`;
  }
  if (row.url) {
    const u = row.url.trim();
    if (u) return `u:${u}`;
  }
  return `f:${row.make || ''}|${row.model || ''}|${row.trim || ''}|${row.mileage || ''}|${row.price || ''}`;
}

function aggregateMakeModel(rows) {
  const map = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const key = `${r.make || 'Unknown'} ${r.model || ''}`.trim();
    map.set(key, (map.get(key) || 0) + 1);
  }
  const arr = [];
  for (const [makeModel, count] of map.entries()) {
    arr.push({ makeModel, count });
  }
  return arr.sort((a, b) => b.count - a.count);
}

function topVehiclesFromMap(map, count = 10) {
  const arr = [];
  for (const [name, c] of map.entries()) {
    arr.push({ name, count: c });
  }
  arr.sort((a, b) => b.count - a.count);
  return arr.slice(0, count).map((it, idx) => ({ ...it, rank: idx + 1 }));
}

router.post('/analytics', async (req, res) => {
  try {
    const filters = req.query || {};
    const startDate = filters?.dateRange?.startDate ? parseISO(filters.dateRange.startDate) : subDays(new Date(), 6);
    const endDate = filters?.dateRange?.endDate ? parseISO(filters.dateRange.endDate) : new Date();

    const start = startOfDay(startDate);
    const end = endOfDay(endDate);

    const competitorIds = Array.isArray(filters.competitors) && filters.competitors.length ? filters.competitors : null;
    const typeFilter = filters.type || null;

    const where = { date: { [Op.between]: [start, end] } };
    if (competitorIds) where.dealershipId = { [Op.in]: competitorIds };
    if (typeFilter) where.type = typeFilter;

    // OPTIMIZATION 2: Selectively query only the columns needed. Limits network/memory bloat.
    const rows = await Inventory.findAll({
      where,
      attributes: ['date', 'dealershipId', 'make', 'model', 'vin', 'url', 'trim', 'mileage', 'price'],
      raw: true
    });

    const rowsByDay = new Map();
    const dateSet = new Set();
    const dealershipIds = new Set();

    // OPTIMIZATION 3: Single iteration pass caching IDs and Date Strings 
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const day = toDayStringFast(r.date);
      r._id = identifierForRow(r); // Cache to save millions of string operations
      r.dealershipId = r.dealershipId || 'unknown';
      
      dealershipIds.add(r.dealershipId);
      dateSet.add(day);
      
      if (!rowsByDay.has(day)) rowsByDay.set(day, []);
      rowsByDay.get(day).push(r);
    }

    const sortedDays = Array.from(dateSet).sort();

    if (sortedDays.length === 0) {
      return res.json({ /* ... your empty response fallback ... */ });
    }

    const latestDay = sortedDays[sortedDays.length - 1];
    const prevDay = sortedDays.length >= 2 ? sortedDays[sortedDays.length - 2] : null;

    const latestRows = rowsByDay.get(latestDay) || [];
    const prevRows = prevDay ? (rowsByDay.get(prevDay) || []) : [];

    const latestIdsByDeal = new Map();
    const prevIdsByDeal = new Map();

    for (let i = 0; i < latestRows.length; i++) {
      const r = latestRows[i];
      if (!latestIdsByDeal.has(r.dealershipId)) latestIdsByDeal.set(r.dealershipId, new Map());
      latestIdsByDeal.get(r.dealershipId).set(r._id, r);
    }

    for (let i = 0; i < prevRows.length; i++) {
      const r = prevRows[i];
      if (!prevIdsByDeal.has(r.dealershipId)) prevIdsByDeal.set(r.dealershipId, new Map());
      prevIdsByDeal.get(r.dealershipId).set(r._id, r);
    }

    const soldByDeal = new Map();
    const newStockByDeal = new Map();

    for (const [dealId, prevMap] of prevIdsByDeal.entries()) {
      const latestMap = latestIdsByDeal.get(dealId) || new Map();
      let count = 0;
      for (const id of prevMap.keys()) if (!latestMap.has(id)) count++;
      if (count > 0) soldByDeal.set(dealId, count);
    }

    for (const [dealId, latestMap] of latestIdsByDeal.entries()) {
      const prevMap = prevIdsByDeal.get(dealId) || new Map();
      let count = 0;
      for (const id of latestMap.keys()) if (!prevMap.has(id)) count++;
      if (count > 0) newStockByDeal.set(dealId, count);
    }

    const totalSold = Array.from(soldByDeal.values()).reduce((s, v) => s + v, 0);
    const totalInventory = latestRows.length;
    const inventoryAdded = Array.from(newStockByDeal.values()).reduce((s, v) => s + v, 0);

    const makeModelInventoryItems = aggregateMakeModel(latestRows);
    const makeModelInventoryAddedItems = aggregateMakeModel(latestRows.filter(r => {
      const prevMap = prevIdsByDeal.get(r.dealershipId) || new Map();
      return !prevMap.has(r._id);
    }));

    const makeModelSoldItems = aggregateMakeModel(prevRows.filter(r => {
      const latestMap = latestIdsByDeal.get(r.dealershipId) || new Map();
      return !latestMap.has(r._id);
    }));

    const makeModelSoldTotal = makeModelSoldItems.reduce((s, it) => s + it.count, 0);

    const dealers = {};
    if (Dealership) {
      // Limit attributes here too
      const found = await Dealership.findAll({ 
        where: { id: { [Op.in]: Array.from(dealershipIds) } }, 
        attributes: ['id', 'name'], 
        raw: true 
      }).catch(() => []);
      for (const d of found) dealers[d.id] = d.name;
    }

    const marketShareDealerships = Array.from(dealershipIds).map(id => {
      const usedSold = soldByDeal.get(id) || 0;
      return {
        id: String(id),
        name: dealers[id] || `Dealer ${id}`,
        usedSold,
        usedSoldMoTrend: Math.round((usedSold / (totalSold || 1)) * 100),
        marketSharePercent: 0,
        color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'),
      };
    });

    const totalUsedSold = marketShareDealerships.reduce((s, d) => s + d.usedSold, 0) || 1;
    for (const d of marketShareDealerships) d.marketSharePercent = Math.round((d.usedSold / totalUsedSold) * 100);

    // OPTIMIZATION 4: Map grouping instead of costly nested .filter() methods for timeline
    const timeline = [];
    for (let i = 0; i < sortedDays.length; i++) {
      const day = sortedDays[i];
      const dayPoint = { date: friendlyLabelFast(day) };
      const dayRows = rowsByDay.get(day) || [];
      
      const countMap = new Map();
      for (let j = 0; j < dayRows.length; j++) {
        const dId = dayRows[j].dealershipId;
        countMap.set(dId, (countMap.get(dId) || 0) + 1);
      }
      
      for (const dId of dealershipIds) {
        dayPoint[String(dealers[dId] || `Dealer ${dId}`)] = countMap.get(dId) || 0;
      }
      timeline.push(dayPoint);
    }

    const soldVehicleMap = new Map();
    for (let i = 0; i < prevRows.length; i++) {
      const r = prevRows[i];
      const latestMap = latestIdsByDeal.get(r.dealershipId) || new Map();
      if (!latestMap.has(r._id)) {
        const name = `${r.make || ''} ${r.model || ''}`.trim();
        soldVehicleMap.set(name, (soldVehicleMap.get(name) || 0) + 1);
      }
    }
    const topSelling = topVehiclesFromMap(soldVehicleMap, 10);

    const invVehicleMap = new Map();
    for (let i = 0; i < latestRows.length; i++) {
      const r = latestRows[i];
      const name = `${r.make || ''} ${r.model || ''}`.trim();
      invVehicleMap.set(name, (invVehicleMap.get(name) || 0) + 1);
    }
    const topStocked = topVehiclesFromMap(invVehicleMap, 10);

    const latestNameCounts = new Map();
    for (const [name, count] of invVehicleMap.entries()) {
      latestNameCounts.set(name, count);
    }

    const outMap = new Map();
    for (let i = 0; i < prevRows.length; i++) {
      const r = prevRows[i];
      const name = `${r.make || ''} ${r.model || ''}`.trim();
      if (!latestNameCounts.has(name) || latestNameCounts.get(name) === 0) {
        outMap.set(name, (outMap.get(name) || 0) + 1);
      }
    }
    const outOfStock = topVehiclesFromMap(outMap, 10);

    const chartDates = sortedDays.map(d => friendlyLabelFast(d));
    const totalSoldChart = chartDates.map((label) => ({ date: label, value: 0 }));
    const inventoryChart = sortedDays.map(d => ({ date: friendlyLabelFast(d), value: (rowsByDay.get(d) || []).length }));

    const inventoryAddedChart = [];
    for (let i = 0; i < sortedDays.length; i++) {
      const d = sortedDays[i];
      const label = friendlyLabelFast(d);
      if (i === 0) {
        inventoryAddedChart.push({ date: label, value: (rowsByDay.get(d) || []).length });
        continue;
      }
      const cur = rowsByDay.get(d) || [];
      const prev = rowsByDay.get(sortedDays[i - 1]) || [];
      
      const prevIds = new Set();
      for (let j = 0; j < prev.length; j++) prevIds.add(prev[j]._id);
      
      let added = 0;
      for (let j = 0; j < cur.length; j++) {
        if (!prevIds.has(cur[j]._id)) added++;
      }
      inventoryAddedChart.push({ date: label, value: added });
    }

    const filterCompetitors = Array.from(dealershipIds).map(id => ({ 
        id: String(id), 
        name: dealers[id] || `Dealer ${id}`, 
        subtitle: '', 
        avatar: String((dealers[id] || `D${id}`)[0] || '?'), 
        color: '#888' 
    }));

    // Construct response identical to original structure...
    const response = {
      filters: { /* ... your original presets ... */ },
      dashboard: {
        totalSold: { title: 'Total Sold', value: totalSold, data: totalSoldChart },
        totalInventory: { title: 'Total Inventory', value: totalInventory, subtitle: 'Net Inv', change: totalInventory - (prevRows.length || 0), data: inventoryChart },
        salesTrend: { value: totalSold },
        inventoryAdded: { title: 'Inventory Added', value: inventoryAdded, subtitle: 'Running Total', data: inventoryAddedChart },
      },
      marketShare: { dealerships: marketShareDealerships, timeline },
      alerts: { topSelling, topStocked, outOfStock },
      makeModelSold: { items: makeModelSoldItems, total: makeModelSoldTotal },
      makeModelInventory: { items: makeModelInventoryItems, total: latestRows.length },
      makeModelInventoryAdded: { items: makeModelInventoryAddedItems, total: inventoryAdded },
    };

    return res.json(response);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;