import { sequelize } from './database.js';

await sequelize.sync({ force: true });
console.log('Database synced successfully.');