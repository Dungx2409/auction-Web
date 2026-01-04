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
    const { q, sort, category, page = 1 } = req.query;
    // Default to 'relevance' when searching, otherwise 'endingSoon'
    const effectiveSort = sort || (q && q.trim() ? 'relevance' : 'endingSoon');
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = 12;

    const searchResult = await dataService.searchProducts(q, { 
      sort: effectiveSort, 
      categoryId: category,
      page: currentPage,
      limit: pageSize
    });

    const watchSet = buildWatchSet(req.watchlistProductIds || req.currentUser?.watchlistIds);
    applyWatchStateToList(searchResult.products, watchSet);

    res.render('search/results', {
      query: q,
      results: searchResult.products,
      sort: effectiveSort,
      selectedCategory: category,
      total: searchResult.total,
      page: searchResult.page,
      totalPages: searchResult.totalPages,
      hasNextPage: searchResult.page < searchResult.totalPages,
      hasPrevPage: searchResult.page > 1,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
