const express = require('express');
const router = express.Router();
const dataService = require('../services/dataService');
const { buildWatchSet, applyWatchStateToList } = require('../helpers/watchlist');

router.get('/', async (req, res, next) => {
  try {
    const [endingSoon, mostBids, highestPrice] = await Promise.all([
      dataService.getProductsEndingSoon(5),
      dataService.getProductsMostBids(5),
      dataService.getProductsHighestPrice(5),
    ]);

    const watchSet = buildWatchSet(req.watchlistProductIds || req.currentUser?.watchlistIds);
    applyWatchStateToList(endingSoon, watchSet);
    applyWatchStateToList(mostBids, watchSet);
    applyWatchStateToList(highestPrice, watchSet);

    res.render('home', {
      title: 'Sàn đấu giá trực tuyến',
      hero: {
        title: 'Khám phá kho đấu giá nổi bật',
        subtitle: 'Theo dõi các phiên sắp kết thúc và ra giá ngay để không bỏ lỡ cơ hội.',
      },
      endingSoon,
      mostBids,
      highestPrice,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/search', async (req, res, next) => {
  try {
    const { q, sort = 'endingSoon', category } = req.query;
    const results = await dataService.searchProducts(q, { sort, categoryId: category });

    const watchSet = buildWatchSet(req.watchlistProductIds || req.currentUser?.watchlistIds);
    applyWatchStateToList(results, watchSet);

    res.render('search/results', {
      query: q,
      results,
      sort,
      selectedCategory: category,
      total: results.length,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
