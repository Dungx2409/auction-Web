const express = require('express');
const { renderAccountPage } = require('./renderAccountPage');

const router = express.Router();

router.get('/watchlist', (req, res, next) => {
	renderAccountPage(req, res, next, { section: 'watchlist' });
});

module.exports = router;
