import express from 'express';
import { Op } from 'sequelize';
import { format, parseISO, startOfDay, endOfDay, subDays } from 'date-fns';
import { sequelize, Inventory, Dealership } from '../configs/database.js';

const router = express.Router();

// ─── Helpers (unchanged) ──────────────────────────────────────────────────────

function toDayString(dt) {
  return format(new Date(dt), 'yyyy-MM-dd');
}

function friendlyLabel(date) {
  return format(new Date(date), 'MMM dd');
}

function identifierForRow(row) {
  if (row.vin && row.vin.trim()) return `vin:${row.vin.trim()}`;
  if (row.url && row.url.trim()) return `url:${row.url.trim()}`;
  return `fm:${row.make || ''}|${row.model || ''}|${row.trim || ''}|${row.mileage || ''}|${row.price || ''}`;
}

function aggregateMakeModel(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = `${r.make || 'Unknown'} ${r.model || ''}`.trim();
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([makeModel, count]) => ({ makeModel, count }))
    .sort((a, b) => b.count - a.count);
}

function topVehiclesFromMap(map, count = 10) {
  return Array.from(map.entries())
    .map(([name, c]) => ({ name, count: c }))
    .sort((a, b) => b.count - a.count)
    .slice(0, count)
    .map((it, idx) => ({ ...it, rank: idx + 1 }));
}

// ─── Minimal column list for row-level queries ────────────────────────────────
// Only pull what we actually need — avoids shipping heavy columns over the wire.
const ROW_ATTRS = ['vin', 'url', 'make', 'model', 'trim', 'mileage', 'price', 'dealershipId'];

// ─── Empty-response helper ────────────────────────────────────────────────────
function emptyResponse() {
  const datePresets = [
    { value: 'today',       label: 'Today' },
    { value: 'yesterday',   label: 'Yesterday' },
    { value: 'last7days',   label: 'Last 7 Days' },
    { value: 'last30days',  label: 'Last 30 Days' },
    { value: 'ytd',         label: 'Year to Date' },
    { value: 'lastQuarter', label: 'Last Quarter' },
  ];
  return {
    filters:   { competitors: [], datePresets },
    dashboard: {
      totalSold:      { title: 'Total Sold',      value: 0, data: [] },
      totalInventory: { title: 'Total Inventory', value: 0, subtitle: 'Net Inv', change: 0, data: [] },
      salesTrend:     { value: 0 },
      inventoryAdded: { title: 'Inventory Added', value: 0, subtitle: 'Running Total', data: [] },
    },
    marketShare:             { dealerships: [], timeline: [] },
    alerts:                  { topSelling: [], topStocked: [], outOfStock: [] },
    makeModelSold:           { items: [], total: 0 },
    makeModelInventory:      { items: [], total: 0 },
    makeModelInventoryAdded: { items: [], total: 0 },
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.post('/analytics', async (req, res) => {
  try {
    const filters = req.query || {};
    const {competitors,dateRange,vehicleType} = req.body || [];
    const startDate = dateRange?.startDate
      ? parseISO(dateRange.startDate)
      : subDays(new Date(), 7);
    const endDate = dateRange?.endDate
      ? parseISO(dateRange.endDate)
      : new Date();

    const start = startOfDay(startDate);
    const end   = endOfDay(endDate);

    // where competitor .selected = true
    const competitorIds = Array.isArray(competitors) && competitors.length > 0
      ? competitors.filter(c => c.selected).map(c => c.id)
      : null;
      // if both used and new
    const typeFilter = vehicleType === 'used' ? 'used'
                     : vehicleType === 'new'  ? 'new'
                     : null;

    // Shared WHERE fragment reused by every query in this request
    const baseWhere = {
      date: { [Op.between]: [start, end] },
      ...(competitorIds && { dealershipId: { [Op.in]: competitorIds } }),
      ...(typeFilter     && { type: typeFilter }),
    };

    // ── OPTIMISATION 1: get distinct days from DB, not from raw rows ──────────
    // Tiny indexed GROUP BY — fast even on millions of rows.
    // Recommended index: CREATE INDEX idx_inv_date ON Inventories (date);
    const dayRows = await Inventory.findAll({
      where:      baseWhere,
      attributes: [[sequelize.fn('DATE', sequelize.col('date')), 'day']],
      group:      [sequelize.fn('DATE', sequelize.col('date'))],
      order:      [[sequelize.fn('DATE', sequelize.col('date')), 'ASC']],
      raw:        true,
    });

    const sortedDays = dayRows.map(r => String(r.day));

    if (sortedDays.length === 0) return res.json(emptyResponse());

    const latestDay = sortedDays[sortedDays.length - 1];
    const prevDay   = sortedDays.length >= 2 ? sortedDays[sortedDays.length - 2] : null;

    // Helper: single-day WHERE clause (inherits competitorIds / typeFilter)
    const dayWhere = (day) => ({
      date: { [Op.between]: [startOfDay(new Date(day)), endOfDay(new Date(day))] },
      ...(competitorIds && { dealershipId: { [Op.in]: competitorIds } }),
      ...(typeFilter     && { type: typeFilter }),
    });

    // ── OPTIMISATION 2: fire all heavy queries in parallel ────────────────────
    //
    //  • latestRows / prevRows  →  only TWO days of row-level data (not the whole
    //                              range), with only the columns we actually need
    //  • timelineAgg            →  DB-level GROUP BY returns one row per
    //                              (day × dealership) instead of millions of rows
    //  • dealershipRecords      →  small lookup table, fetched concurrently
    //
    // Recommended index: CREATE INDEX idx_inv_date_dealer ON Inventories (date, dealershipId);
    const [latestRows, prevRows, timelineAgg, dealershipRecords] = await Promise.all([

      Inventory.findAll({ where: dayWhere(latestDay), attributes: ROW_ATTRS, raw: true }),

      prevDay
        ? Inventory.findAll({ where: dayWhere(prevDay), attributes: ROW_ATTRS, raw: true })
        : Promise.resolve([]),

      Inventory.findAll({
        where:      baseWhere,
        attributes: [
          [sequelize.fn('DATE', sequelize.col('date')), 'day'],
          'dealershipId',
          [sequelize.fn('COUNT', sequelize.literal('*')), 'cnt'],
        ],
        group: [sequelize.fn('DATE', sequelize.col('date')), 'dealershipId'],
        raw:   true,
      }),

      Dealership
        ? Dealership.findAll({
            where: competitorIds ? { id: { [Op.in]: competitorIds } } : undefined,
            raw:   true,
          }).catch(() => [])
        : Promise.resolve([]),
    ]);

    // ── Build dealer name lookup ───────────────────────────────────────────────
    const dealers = {};
    for (const d of dealershipRecords) dealers[d.id] = d.name;

    // ── OPTIMISATION 3: use Set (not Map-of-Map) for O(1) membership tests ────
    // dealershipId → Set<identifier>
    const latestIdsByDeal = new Map();
    const prevIdsByDeal   = new Map();

    for (const r of latestRows) {
      const did = r.dealershipId || 'unknown';
      if (!latestIdsByDeal.has(did)) latestIdsByDeal.set(did, new Set());
      latestIdsByDeal.get(did).add(identifierForRow(r));
    }
    for (const r of prevRows) {
      const did = r.dealershipId || 'unknown';
      if (!prevIdsByDeal.has(did)) prevIdsByDeal.set(did, new Set());
      prevIdsByDeal.get(did).add(identifierForRow(r));
    }

    // ── Sold / added counts per dealership ────────────────────────────────────
    const soldByDeal     = new Map();
    const newStockByDeal = new Map();

    for (const [did, prevSet] of prevIdsByDeal.entries()) {
      const latestSet = latestIdsByDeal.get(did) || new Set();
      let sold = 0;
      for (const id of prevSet) if (!latestSet.has(id)) sold++;
      if (sold) soldByDeal.set(did, sold);
    }

    for (const [did, latestSet] of latestIdsByDeal.entries()) {
      const prevSet = prevIdsByDeal.get(did) || new Set();
      let added = 0;
      for (const id of latestSet) if (!prevSet.has(id)) added++;
      if (added) newStockByDeal.set(did, added);
    }

    const totalSold      = [...soldByDeal.values()].reduce((s, v) => s + v, 0);
    const totalInventory = latestRows.length;
    const inventoryAdded = [...newStockByDeal.values()].reduce((s, v) => s + v, 0);

    // ── Make/model aggregations ───────────────────────────────────────────────
    const makeModelInventoryItems = aggregateMakeModel(latestRows);

    const makeModelInventoryAddedItems = aggregateMakeModel(
      latestRows.filter(r =>
        !(prevIdsByDeal.get(r.dealershipId || 'unknown') || new Set()).has(identifierForRow(r))
      )
    );

    const makeModelSoldItems = aggregateMakeModel(
      prevRows.filter(r =>
        !(latestIdsByDeal.get(r.dealershipId || 'unknown') || new Set()).has(identifierForRow(r))
      )
    );

    const makeModelSoldTotal = makeModelSoldItems.reduce((s, it) => s + it.count, 0);

    // ── Collect all dealership IDs present in any result ─────────────────────
    const dealershipIds = new Set([
      ...latestRows.map(r => r.dealershipId || 'unknown'),
      ...prevRows.map(r => r.dealershipId || 'unknown'),
      ...timelineAgg.map(r => r.dealershipId || 'unknown'),
    ]);

    // ── Market share ──────────────────────────────────────────────────────────
    const marketShareDealerships = Array.from(dealershipIds).map(id => ({
      id:                 String(id),
      name:               dealers[id] || `Dealer ${id}`,
      usedSold:           soldByDeal.get(id) || 0,
      usedSoldMoTrend:    Math.round(((soldByDeal.get(id) || 0) / (totalSold || 1)) * 100),
      marketSharePercent: 0,
      color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
    }));

    const totalUsedSold = marketShareDealerships.reduce((s, d) => s + d.usedSold, 0) || 1;
    for (const d of marketShareDealerships) {
      d.marketSharePercent = Math.round((d.usedSold / totalUsedSold) * 100);
    }

    // ── OPTIMISATION 4: build timeline from DB-aggregated rows ───────────────
    // Pre-group agg results so each day/dealer lookup is O(1)
    const timelineByDay    = new Map(); // day → { dealerName: cnt }
    const timelineSumByDay = new Map(); // day → total inventory count

    for (const row of timelineAgg) {
      const day      = String(row.day);
      const cnt      = Number(row.cnt);
      const dealName = dealers[row.dealershipId] || `Dealer ${row.dealershipId}`;

      if (!timelineByDay.has(day)) timelineByDay.set(day, {});
      timelineByDay.get(day)[dealName] = cnt;
      timelineSumByDay.set(day, (timelineSumByDay.get(day) || 0) + cnt);
    }

    const timeline = sortedDays.map(day => {
      const point = { date: friendlyLabel(day), ...(timelineByDay.get(day) || {}) };
      for (const dId of dealershipIds) {
        const dealName = dealers[dId] || `Dealer ${dId}`;
        if (!(dealName in point)) point[dealName] = 0;
      }
      return point;
    });

    // ── Alerts ────────────────────────────────────────────────────────────────
    const soldVehicleMap = new Map();
    for (const r of prevRows) {
      if (!(latestIdsByDeal.get(r.dealershipId || 'unknown') || new Set()).has(identifierForRow(r))) {
        const name = `${r.make || ''} ${r.model || ''}`.trim();
        soldVehicleMap.set(name, (soldVehicleMap.get(name) || 0) + 1);
      }
    }

    // OPTIMISATION 5: build invVehicleMap in one pass and reuse for outOfStock
    const invVehicleMap = new Map();
    for (const r of latestRows) {
      const name = `${r.make || ''} ${r.model || ''}`.trim();
      invVehicleMap.set(name, (invVehicleMap.get(name) || 0) + 1);
    }

    const outMap = new Map();
    for (const r of prevRows) {
      const name = `${r.make || ''} ${r.model || ''}`.trim();
      if (!invVehicleMap.has(name)) outMap.set(name, (outMap.get(name) || 0) + 1);
    }

    const topSelling = topVehiclesFromMap(soldVehicleMap, 10);
    const topStocked = topVehiclesFromMap(invVehicleMap, 10);
    const outOfStock = topVehiclesFromMap(outMap, 10);

    // ── Chart data ────────────────────────────────────────────────────────────
    // totalSoldChart: preserved as-is (matches original behaviour)
    const totalSoldChart = sortedDays.map(d => ({ date: friendlyLabel(d), value: 0 }));

    // inventoryChart: total inventory per day from DB aggregation (no row scan needed)
    const inventoryChart = sortedDays.map(day => ({
      date:  friendlyLabel(day),
      value: timelineSumByDay.get(day) || 0,
    }));

    // inventoryAddedChart: exact identifier-based count for latest→prev transition;
    // consecutive-day delta from aggregated counts for intermediate days.
    const inventoryAddedChart = sortedDays.map((day, idx) => {
      if (idx === 0)      return { date: friendlyLabel(day), value: timelineSumByDay.get(day) || 0 };
      if (day === latestDay) return { date: friendlyLabel(day), value: inventoryAdded };
      const cur  = timelineSumByDay.get(day) || 0;
      const prev = timelineSumByDay.get(sortedDays[idx - 1]) || 0;
      return { date: friendlyLabel(day), value: Math.max(0, cur - prev) };
    });

    // ── Filter competitors list ───────────────────────────────────────────────

    const filterCompetitors = competitors.length>0 ? competitors : Array.from(dealershipIds).map(id => ({
      id:       String(id),
      name:     dealers[id] || `Dealer ${id}`,
      subtitle: '',
      avatar:   String((dealers[id] || `D${id}`)[0] || '?'),
      color:    '#888',
      selected: true
    }));

    // const datePresets = [
    //   { value: 'today',       label: 'Today' },
    //   { value: 'yesterday',   label: 'Yesterday' },
    //   { value: 'last7days',   label: 'Last 7 Days' },
    //   { value: 'last30days',  label: 'Last 30 Days' },
    //   { value: 'ytd',         label: 'Year to Date' },
    //   { value: 'lastQuarter', label: 'Last Quarter' },
    // ];
    return res.json({
      filters: { competitors: filterCompetitors,vehicleType: "both", dateRange: { startDate: toDayString(start), endDate: toDayString(end) } },
      dashboard: {
        totalSold:      { title: 'Total Sold', value: totalSold, data: totalSoldChart },
        totalInventory: { title: 'Total Inventory', value: totalInventory, subtitle: 'Net Inv',
                          change: totalInventory - prevRows.length, data: inventoryChart },
        salesTrend:     { value: totalSold },
        inventoryAdded: { title: 'Inventory Added', value: inventoryAdded,
                          subtitle: 'Running Total', data: inventoryAddedChart },
      },
      marketShare:             { dealerships: marketShareDealerships, timeline },
      alerts:                  { topSelling, topStocked, outOfStock },
      makeModelSold:           { items: makeModelSoldItems, total: makeModelSoldTotal },
      makeModelInventory:      { items: makeModelInventoryItems, total: latestRows.length },
      makeModelInventoryAdded: { items: makeModelInventoryAddedItems, total: inventoryAdded },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

router.get('/health', (req, res) => res.json({ ok: true }));

export default router;