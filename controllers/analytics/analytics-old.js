import { Op } from 'sequelize';
import { format, parseISO, startOfDay, endOfDay, subDays, startOfMonth } from 'date-fns';
import { sequelize, Inventory, Dealership } from '../../configs/database.js';
import getInventoryAdded from './inventoryAdded.js';
import getInventorySold from './inventorySold.js';
import getInventory from './inventory.js';
import getTotalSoldChart from './totalSoldChart.js';

function toDayString(dt) {
  return format(new Date(dt), 'yyyy-MM-dd');
}

function friendlyLabel(date) {
  return format(new Date(date), 'MMM dd');
}


function identifierForRow(row) {
  if (row.vin && row.vin.trim()) return `vin:${row.vin.trim().toLowerCase()}`;
  if (row.url && row.url.trim()) return `url:${row.url.trim().toLowerCase()}`;
  return `fm:${row.make || ''}|${row.model || ''}|${row.trim || ''}`.toLowerCase();
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
function aggregateMakeModelCategorized(rows, myDealershipId) {
  const map = new Map();
  const totals = { my: 0, all: 0, competitors: 0 };

  for (const r of rows) {
    const key = `${r.make || 'Unknown'} ${r.model || ''}`.trim();
    if (!map.has(key)) {
      map.set(key, { makeModel: key, counts: { my: 0, all: 0, competitors: 0 } });
    }

    const item = map.get(key);
    const isMyDealer = String(r.dealershipId) === String(myDealershipId);

    // Increment item counts
    item.counts.all++;
    if (isMyDealer) item.counts.my++;
    else item.counts.competitors++;

    // Increment global totals
    totals.all++;
    if (isMyDealer) totals.my++;
    else totals.competitors++;
  }

  const items = Array.from(map.values()).sort((a, b) => b.counts.all - a.counts.all);
  return { items, totals };
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
const ROW_ATTRS = ['vin', 'make', 'model', 'mileage', 'price', 'dealershipId'];

// ─── Empty-response helper ────────────────────────────────────────────────────
function emptyResponse(filters) {
  return {
    filters: filters,
    dashboard: {
      totalSold: { title: 'Total Sold', value: 0, data: [] },
      totalInventory: { title: 'Total Inventory', value: 0, subtitle: 'Net Inv', change: 0, data: [] },
      salesTrend: { value: 0 },
      inventoryAdded: { title: 'Inventory Added', value: 0, subtitle: 'Running Total', data: [] },
    },
    marketShare: { dealerships: [], timeline: [] },
    alerts: { topSelling: [], topStocked: [], outOfStock: [] },
    makeModelSold: { items: [], total: 0 },
    makeModelInventory: { items: [], total: 0 },
    makeModelInventoryAdded: { items: [], total: 0 },
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

const analyticsController = async (req, res) => {
  req.user = { dealershipId: 5 };
  try {
    const { competitors, dateRange: { startDate, endDate }, vehicleType } = res.locals.filters;

    const competitorIds = competitors.filter(c => c.selected).map(c => c.id);
    const typeFilter = ['new', 'used'].includes(vehicleType) ? vehicleType : null;

    const baseWhere = {
      date: { [Op.between]: [startDate, endDate] },
      dealershipId: { [Op.in]: competitorIds },
      ...(typeFilter && { type: typeFilter }),
    };

    // Recommended index: CREATE INDEX idx_inv_date ON Inventories (date);
    const dayRows = await Inventory.findAll({
      where: baseWhere,
      attributes: [['date', 'day']],
      group: ['date'],
      order: [['date', 'ASC']],
      raw: true,
    });
    const sortedDays = dayRows.map(r => String(r.day));

    if (sortedDays.length === 0) return res.json(emptyResponse(res.locals.filters));

    const latestDay = sortedDays[sortedDays.length - 1];
    const prevDay = sortedDays.length >= 2 ? sortedDays[sortedDays.length - 2] : null;

    // Helper: single-day WHERE clause (inherits competitorIds / typeFilter)
    const dayWhere = (day) => ({
      date: { [Op.between]: [startOfDay(new Date(day)), endOfDay(new Date(day))] },
      ...(competitorIds && { dealershipId: { [Op.in]: competitorIds } }),
      ...(typeFilter && { type: typeFilter }),
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
        where: baseWhere,
        attributes: [
          ['date', 'day'],
          'dealershipId',
          [sequelize.fn('COUNT', sequelize.literal('*')), 'cnt'],
        ],
        group: ['date', 'dealershipId'],
        raw: true,
      }),

      Dealership
        ? Dealership.findAll({
          where: competitorIds ? { id: { [Op.in]: competitorIds } } : undefined,
          raw: true,
        }).catch(() => [])
        : Promise.resolve([]),
    ]);

    // ── Build dealer name lookup ───────────────────────────────────────────────
    const dealers = {};
    for (const d of dealershipRecords) dealers[d.id] = d.name;

    // ── OPTIMISATION 3: use Set (not Map-of-Map) for O(1) membership tests ────
    // dealershipId → Set<identifier>
    const latestIdsByDeal = new Map();
    const prevIdsByDeal = new Map();

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
    const soldByDeal = new Map();
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

    const totalSold = [...soldByDeal.values()].reduce((s, v) => s + v, 0);
    const totalInventory = latestRows.length;
    const inventoryAdded = [...newStockByDeal.values()].reduce((s, v) => s + v, 0);

    // ── Make/model aggregations ───────────────────────────────────────────────
    const myDid = String(req.user?.dealershipId || '');

    // ── Make/model aggregations ───────────────────────────────────────────────
    const makeModelInventoryData = aggregateMakeModelCategorized(latestRows, myDid);

    const makeModelInventoryAddedData = aggregateMakeModelCategorized(
      latestRows.filter(r =>
        !(prevIdsByDeal.get(r.dealershipId || 'unknown') || new Set()).has(identifierForRow(r))
      ),
      myDid
    );

    const makeModelSoldData = aggregateMakeModelCategorized(
      prevRows.filter(r =>
        !(latestIdsByDeal.get(r.dealershipId || 'unknown') || new Set()).has(identifierForRow(r))
      ),
      myDid
    );

    // const makeModelSoldTotal = makeModelSoldItems.reduce((s, it) => s + it.count, 0);

    // ── Collect all dealership IDs present in any result ─────────────────────
    const dealershipIds = new Set([
      ...latestRows.map(r => r.dealershipId || 'unknown'),
      ...prevRows.map(r => r.dealershipId || 'unknown'),
      ...timelineAgg.map(r => r.dealershipId || 'unknown'),
    ]);

    // ── Market share ──────────────────────────────────────────────────────────
    const marketShareDealerships = Array.from(dealershipIds).map(id => ({
      id: String(id),
      name: dealers[id] || `Dealer ${id}`,
      usedSold: soldByDeal.get(id) || 0,
      usedSoldMoTrend: Math.round(((soldByDeal.get(id) || 0) / (totalSold || 1)) * 100),
      marketSharePercent: 0,
      color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
    }));

    const totalUsedSold = marketShareDealerships.reduce((s, d) => s + d.usedSold, 0) || 1;
    for (const d of marketShareDealerships) {
      d.marketSharePercent = Math.round((d.usedSold / totalUsedSold) * 100);
    }
    // Sort: My dealership first, then by sales volume
    marketShareDealerships.sort((a, b) => {
      if (a.id === myDid) return -1;
      if (b.id === myDid) return 1;
      return b.usedSold - a.usedSold;
    });
    // ── OPTIMISATION 4: build timeline from DB-aggregated rows ───────────────
    // Pre-group agg results so each day/dealer lookup is O(1)
    const timelineByDay = new Map(); // day → { dealerName: cnt }
    const timelineSumByDay = new Map(); // day → total inventory count

    for (const row of timelineAgg) {
      const day = String(row.day);
      const cnt = Number(row.cnt);
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
    // const totalSoldChart = sortedDays.map(d => ({ date: friendlyLabel(d), value: 0 }));
    // 1. Fetch ALL rows in the range once (Optimized)
    const allRows = await Inventory.findAll({
      where: baseWhere,
      attributes: ['date', ...ROW_ATTRS],
      raw: true,
    });

    // 2. Map every day to its set of vehicle IDs
    const idsByDay = new Map();
    for (const r of allRows) {
      // Use toDayString or a direct check to ensure we get a valid YYYY-MM-DD key
      const dStr = r.date instanceof Date ? format(r.date, 'yyyy-MM-dd') : toDayString(r.date);
      if (dStr === 'unknown') continue;

      if (!idsByDay.has(dStr)) idsByDay.set(dStr, new Set());
      idsByDay.get(dStr).add(identifierForRow(r));
    }

    // 3. Compare Day(i) vs Day(i-1) to find "Sold"
    const totalSoldChart = sortedDays.map((day, idx) => {
      const label = friendlyLabel(day);
      if (idx === 0) return { date: label, value: 0 }; // No previous day to compare

      const currentDayKey = day; // sortedDays are already yyyy-mm-dd strings
      const prevDayKey = sortedDays[idx - 1];

      const currentSet = idsByDay.get(currentDayKey) || new Set();
      const prevSet = idsByDay.get(prevDayKey) || new Set();

      let soldCount = 0;
      // If it was there yesterday but NOT there today, it counts as SOLD
      for (const id of prevSet) {
        if (!currentSet.has(id)) {
          soldCount++;
        }
      }

      return { date: label, value: soldCount };
    });

    // inventoryChart: total inventory per day from DB aggregation (no row scan needed)
    const inventoryChart = sortedDays.map(day => ({
      date: friendlyLabel(day),
      value: timelineSumByDay.get(day) || 0,
    }));

    // inventoryAddedChart: exact identifier-based count for latest→prev transition;
    // consecutive-day delta from aggregated counts for intermediate days.
    const inventoryAddedChart = sortedDays.map((day, idx) => {
      if (idx === 0) return { date: friendlyLabel(day), value: timelineSumByDay.get(day) || 0 };
      if (day === latestDay) return { date: friendlyLabel(day), value: inventoryAdded };
      const cur = timelineSumByDay.get(day) || 0;
      const prev = timelineSumByDay.get(sortedDays[idx - 1]) || 0;
      return { date: friendlyLabel(day), value: Math.max(0, cur - prev) };
    });


    return res.json({
      filters: { competitors: competitors, vehicleType: vehicleType || 'both', dateRange: { startDate: toDayString(startDate), endDate: toDayString(endDate) } },
      dashboard: {
        totalSold: { title: 'Total Sold', value: totalSoldChart.reduce((sum, day) => sum + day.value, 0), data: await getTotalSoldChart(res.locals.filters) },
        totalInventory: {
          title: 'Total Inventory', value: totalInventory, subtitle: 'Net Inv',
          change: totalInventory - prevRows.length, data: inventoryChart,
        },
        salesTrend: { value: totalSold },
        inventoryAdded: {
          title: 'Inventory Added', value: inventoryAdded,
          subtitle: 'Running Total', data: inventoryAddedChart
        },
      },
      marketShare: { dealerships: marketShareDealerships, timeline },
      alerts: { topSelling, topStocked, outOfStock },
      makeModelSold: await getInventorySold(5,baseWhere),
      //{ items: makeModelSoldData.items, total: makeModelSoldData.totals },
      makeModelInventory: await getInventory(5,baseWhere),
      //{ items: makeModelInventoryData.items, total: makeModelInventoryData.totals },
      makeModelInventoryAdded: await getInventoryAdded(5,baseWhere),//{ items: makeModelInventoryAddedData.items, total: makeModelInventoryAddedData.totals }, // Placeholder for actual data; implement similarly to sold/inventory if needed
      user: { dealershipId: req.user?.dealershipId },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
};



export default analyticsController;