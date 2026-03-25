import bcrypt from 'bcrypt';
import { sequelize, User } from '../configs/database.js';

const addUser = async () => {
    try {
        // Get command line arguments
        const args = process.argv.slice(2);

        if (args.length < 3) {
            console.log('Usage: node addUser.js <username> <password> <email> [dealershipId]');
            console.log('Example: node addUser.js john secret123 john@example.com 5');
            process.exit(1);
        }

        const [username, password, email, dealershipId] = args;

        // Validate inputs
        if (!username || !password || !email) {
            console.error('Error: Username, password, and email are required');
            process.exit(1);
        }

        // Check if user already exists
        const existingUser = await User.findOne({ where: { username } });
        if (existingUser) {
            console.error(`Error: User '${username}' already exists`);
            process.exit(1);
        }

        // Check if email already exists
        const existingEmail = await User.findOne({ where: { email } });
        if (existingEmail) {
            console.error(`Error: Email '${email}' already exists`);
            process.exit(1);
        }

        // Hash password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Create user
        const newUser = await User.create({
            username,
            password: hashedPassword,
            email,
            dealershipId: dealershipId ? parseInt(dealershipId) : null
        });

        console.log('✓ User created successfully!');
        console.log(`  ID: ${newUser.id}`);
        console.log(`  Username: ${newUser.username}`);
        console.log(`  Email: ${newUser.email}`);
        console.log(`  Dealership ID: ${newUser.dealershipId || 'Not assigned'}`);

        process.exit(0);
    } catch (error) {
        console.error('Error creating user:', error.message);
        process.exit(1);
    }
};

// Run the script
addUser();