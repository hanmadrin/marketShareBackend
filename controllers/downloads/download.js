import { getInventoryRawData } from "../analytics/inventory.js";
import {getInventoryAddedRawData} from "../analytics/inventoryAdded.js"
import { getInventorySoldRawData } from "../analytics/inventorySold.js";
import {getTopSellingVehiclesRawData,getTopStockedVehiclesRawData,getTopOutOfStockVehiclesRawData} from "../analytics/alertsPageData.js";
const downloadsController = async (req, res) => {
    const action = req.body.action;
    const makeModel = req.body.makeModel;
    let rawData = [];
    // console.log(action)
    switch (action) {
        case 'makeModelInventory':
            rawData = await getInventoryRawData(res.locals.filters,makeModel);
            break;
        case "inventoryGraph":
            rawData = await getInventoryRawData(res.locals.filters,makeModel,"graph");
            break;
        case 'makeModelAdded':
        case'inventoryAddedGraph':
            rawData = await getInventoryAddedRawData(res.locals.filters,makeModel);
            break;
            case 'makeModelSold':
            case 'inventorySoldGraph':
            case 'salesByDealership':
                    rawData = await getInventorySoldRawData(res.locals.filters,makeModel);
            break;
        case 'topSelling':
            rawData = await getTopSellingVehiclesRawData(res.locals.filters,makeModel);
            break;
        case 'topStocked':
            rawData = await getTopStockedVehiclesRawData(res.locals.filters,makeModel);
            break;
        case 'outOfStock':
            rawData = await getTopOutOfStockVehiclesRawData(res.locals.filters,makeModel);
            break;
        default:
            return res.status(500).send('Invalid action');
    }


    return res.status(200).json(rawData);
    // const csvHeaders = Object.keys(rawData[0]).join(',') + '\n';
    // const csvData = rawData.map(r => Object.values(r).join(',')).join('\n');
    // res.setHeader('Content-Type', 'text/csv');
    // return res.status(200).send(Buffer.from(csvHeaders + csvData, 'utf-8'));

}

export default downloadsController