import { Sequelize, DataTypes } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config({quiet: true});
// Initialize Connection
export const sequelize = new Sequelize(
    process.env.DATABASE_NAME,
    process.env.DATABASE_USERNAME,
    process.env.DATABASE_PASSWORD,
    {
        host: '127.0.0.1',
        dialect: 'mysql',
        dialectOptions: {
            charset: 'utf8',
            multipleStatements: true
        },
        logging: false,
    }
);

// Define Models
export const Dealership = sequelize.define('Dealership', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: DataTypes.STRING,
    postcode: DataTypes.STRING,
    city: DataTypes.STRING,
    state: DataTypes.STRING,
    used_url: DataTypes.STRING,
    new_url: DataTypes.STRING,
    base_url: DataTypes.STRING,
    inventory_common_url: DataTypes.STRING
});

export const User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    username: { type: DataTypes.STRING, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false, unique: true }
});

export const Order = sequelize.define('Order', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    type: DataTypes.STRING
});

export const Inventory = sequelize.define('Inventory', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    first_seen: { type: DataTypes.DATEONLY, allowNull: false },
    last_seen: { type: DataTypes.DATEONLY, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false },
    year: { type: DataTypes.INTEGER, allowNull: false },
    make: { type: DataTypes.STRING, allowNull: false },
    model: { type: DataTypes.STRING, allowNull: false },
    trim: { type: DataTypes.STRING, allowNull: true },
    mileage: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    price: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    url: { type: DataTypes.STRING, allowNull: false },
    vin: { type: DataTypes.STRING, allowNull: false }
}, {
    indexes: [
        {
            unique: true,
            fields: ['url'] // URL is now the unique identifier for a vehicle record
        }
    ],
    timestamps: false,
    // createdat, updated at false


});

// Associations
Dealership.hasMany(User, { foreignKey: 'dealershipId' });
User.belongsTo(Dealership, { foreignKey: 'dealershipId' });

Dealership.hasMany(Inventory, { foreignKey: 'dealershipId' });
Inventory.belongsTo(Dealership, { foreignKey: 'dealershipId' });

Dealership.hasMany(Order, { foreignKey: 'dealershipId' });
Order.belongsTo(Dealership, { foreignKey: 'dealershipId' });

User.hasMany(Order, { foreignKey: 'userId' });
Order.belongsTo(User, { foreignKey: 'userId' });