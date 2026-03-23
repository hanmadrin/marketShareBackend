import { Op } from 'sequelize';
import { format, startOfDay, endOfDay, eachDayOfInterval, differenceInDays, subDays, isSameDay } from 'date-fns';
import { sequelize, Inventory, Dealership } from '../../configs/database.js';
import getInventoryAdded from './inventoryAdded.js';
import {getInventorySold,getAverageSold} from './inventorySold.js';
import { getInventory, getInventoryDate,getInventoryAverage } from './inventory.js';
import { getSoldGraphData, getNewStockGraphdata, getInventoryGraphData } from './homePageData.js';
import { getTopSellingVehicles, getTopStockedVehicles, getTopOutOfStockVehicles } from './alertsPageData.js';
import { getSalesByDealershipData,getMarketShareByDealership } from './marketShareData.js';
import {getGraphColor} from './colors.js';
function toDayString(dt) { return format(new Date(dt), 'yyyy-MM-dd'); }



const analyticsController = async (req, res) => {
  const { startDate, endDate } = res.locals.filters.dateRange
  try {
    const soldGraphdata = await getSoldGraphData(res.locals.filters)
    const newStockGraphdata = await getNewStockGraphdata(res.locals.filters)
    const inventoryGraphData = await getInventoryGraphData(res.locals.filters)
    const totalSoldValue = soldGraphdata.map(r => r.value).reduce((a, b) => a + b, 0);
    // date difference between soldGraphdata first and last day
    // console.log(differenceInDays(new Date("Mar 5 2026"),new Date("Feb 6 2026")))
    // const totalDateCount =
    //   soldGraphdata.length > 1
    //     ? differenceInDays(
    //       new Date(soldGraphdata[soldGraphdata.length - 1].date),
    //       new Date(soldGraphdata[0].date)
    //     )
    //     : soldGraphdata.length;
    // total date count = end date - start date
    const totalDateCount = differenceInDays(startOfDay(new Date(endDate)),startOfDay(new Date(startDate))) + 1
    // console.log(totalDateCount)
    return res.json({
      filters: res.locals.filters,
      dashboard: {
        totalSold: {
          title: 'Sold',
          value: totalSoldValue,
          data: soldGraphdata
        },
        totalInventory: {
          title: 'Inventory',
          value: inventoryGraphData.length > 0 ? inventoryGraphData[inventoryGraphData.length - 1].value : 0,
          subtitle: 'Net Inv',
          change: inventoryGraphData.length > 1 ? inventoryGraphData[inventoryGraphData.length - 1].value - inventoryGraphData[0].value : 0,
          data: inventoryGraphData,

        },
        salesTrend: {
          // 30 days sales trend
          value: totalDateCount > 0 ? Math.round(totalSoldValue / totalDateCount * 30) : 0,
        },
        inventoryAdded: {
          title: 'Inventory Added',
          value: newStockGraphdata.map(r => r.value).reduce((a, b) => a + b, 0),
          subtitle: 'Running Total',
          data: newStockGraphdata,

        },
        averageSold: await getAverageSold(res.locals.filters, res.locals.user),
        inStockSold: await getInventoryAverage(res.locals.filters, res.locals.user),
      },
      alerts: {
        topSelling: await getTopSellingVehicles(res.locals.filters),
        topStocked: await getTopStockedVehicles(res.locals.filters),
        outOfStock: await getTopOutOfStockVehicles(res.locals.filters)
      },
      marketShare: {
        //  dealerships:marketShareDealerships,
         dealerships: await getMarketShareByDealership(res.locals.filters, res.locals.user), 
         timeline: await getSalesByDealershipData(res.locals.filters)
         },
      makeModelSold: await getInventorySold(res.locals.filters, res.locals.user),
      makeModelInventory: await getInventory(res.locals.filters, res.locals.user),
      makeModelInventoryAdded: await getInventoryAdded(res.locals.filters, res.locals.user),
      user: { dealershipId: req.user?.dealershipId },
      inventoryDate: await getInventoryDate(res.locals.filters)
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
};

export default analyticsController;