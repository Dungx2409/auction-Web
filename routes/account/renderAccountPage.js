const { buildAccountContext } = require('./accountMiddleware');

async function renderAccountPage(req, res, next, { section = 'profile', statusCode = 200, extras = {} } = {}) {
  try {
    const context = await buildAccountContext(req.currentUser, {
      ...extras,
      activeSection: section,
    });
    res.status(statusCode).render('account/overview', context);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  renderAccountPage,
};
