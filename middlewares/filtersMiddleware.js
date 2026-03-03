import { format, parseISO, startOfDay, endOfDay, subDays, startOfMonth } from 'date-fns';
import { Dealership } from '../configs/database.js';
const filtersMiddleware = async (req, res, next) => {
  const ownerDealershipId = res.locals.user?.dealershipId;

  let { selectedCompetitors, dateRange, vehicleType } = req.body || {};
  const startDate = dateRange?.startDate
    ? parseISO(dateRange.startDate)
    // : startOfMonth(new Date());
    : subDays(new Date(), 30);  
  const endDate = dateRange?.endDate
    ? parseISO(dateRange.endDate)
    : new Date();

  vehicleType = ['new', 'used'].includes(vehicleType) ? vehicleType : 'both';  
  
  // getting all dealerdships
  const allDealerships = await Dealership.findAll({
    attributes: ['id', 'name', 'new_url', 'used_url']
  });

  allDealerships.forEach(d => {
    const { new_url, used_url, name } = d.dataValues;

    // Logic for Subtitle
    const labels = [];
    if (new_url) labels.push('New');
    if (used_url) labels.push('Used');

    d.dataValues.subtitle = labels.join(' | ');
    d.dataValues.selected = selectedCompetitors.length==0? true : selectedCompetitors?.includes(d.id) || false;
    d.dataValues.avatar = String(name).charAt(0).toUpperCase();
  });
  const ownerIdx = allDealerships.findIndex(d => d.id === ownerDealershipId);
  if (ownerIdx > 0) {
    [allDealerships[0], allDealerships[ownerIdx]] = [allDealerships[ownerIdx], allDealerships[0]];
  }

  res.locals.filters = {
    dateRange: { startDate, endDate },
    vehicleType,
    competitors: allDealerships.map(d => ({ id: d.id, name: d.name, selected: d.dataValues.selected, avatar: d.dataValues.avatar, subtitle: d.dataValues.subtitle })),
  }
  next();
};

export default filtersMiddleware;