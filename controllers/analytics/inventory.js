import { Inventory, sequelize } from '../../configs/database.js';
import { Op } from 'sequelize';

const inventory = async (dealershipId, baseWhere) => {
  const rows = await Inventory.findAll({
    attributes: [
      'make',
      'model',
      [sequelize.literal("CONCAT(make, ' ', model)"), 'makeModel'],

      // Total unique (vin + url)
      [
        sequelize.literal("COUNT(DISTINCT vin, url, make, model)"),
        'allCount'
      ],

      // My dealership unique (vin + url)
      [
        sequelize.literal(
          `COUNT(DISTINCT CASE WHEN dealershipId = ${dealershipId} THEN vin END, 
                              CASE WHEN dealershipId = ${dealershipId} THEN url END)`
        ),
        'myCount'
      ],

      // Competitors unique (vin + url)
      [
        sequelize.literal(
          `COUNT(DISTINCT CASE WHEN dealershipId != ${dealershipId} THEN vin END, 
                              CASE WHEN dealershipId != ${dealershipId} THEN url END)`
        ),
        'competitorCount'
      ]
    ],
    where: baseWhere,
    group: ['make', 'model'],
    raw: true
  });

  let total = { my: 0, all: 0, competitors: 0 };

  const items = rows.map(row => {
    const my = Number(row.myCount) || 0;
    const all = Number(row.allCount) || 0;
    const competitors = Number(row.competitorCount) || 0;

    total.my += my;
    total.all += all;
    total.competitors += competitors;

    return {
      makeModel: row.makeModel,
      counts: { my, all, competitors }
    };
  });

  return { items, total };
};

export default inventory;