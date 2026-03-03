const userMiddleware = async (req, res, next) => {
    res.locals.user = {
        id: 1,
        name: 'Michael Ritter',
        dealershipId: 5
    };


    next();
};

export default userMiddleware;