import { User } from '../configs/database.js';

const userMiddleware = async (req, res, next) => {
    try {
        const userId = req.headers['x-user-id'];

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
        }

        const user = await User.findByPk(userId);

        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid authentication' 
            });
        }

        res.locals.user = {
            id: user.id,
            name: user.username,
            dealershipId: user.dealershipId
        };

        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
};

export default userMiddleware;
