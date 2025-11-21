const express = require('express');
const router = express.Router();
const dataService = require('../services/dataService');

const PAGE_SIZE = 9;

async function renderList(req, res, next, categoryId) {
  try {
    const { page = 1, sort = 'endingSoon' } = req.query;
    const pageNumber = Math.max(1, parseInt(page, 10) || 1);

    const results = await dataService.searchProducts(undefined, { sort, categoryId });
    // console.log('Search results:', results);
    const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
    const start = (pageNumber - 1) * PAGE_SIZE;
    const paged = results.slice(start, start + PAGE_SIZE);
    const category = categoryId ? await dataService.getCategoryById(categoryId) : null;
    res.render('products/list', {
      products: paged,
      total: results.length,
      page: pageNumber,
      totalPages,
      sort,
      category,
      categoryId,
    });
  } catch (error) {
    next(error);
  }
}

router.get('/', (req, res, next) => renderList(req, res, next));

router.get('/category/:categoryId', (req, res, next) => renderList(req, res, next, req.params.categoryId));

// Product detail
router.get('/:id', async (req, res, next) => {
  try {
    const product = await dataService.getProductById(req.params.id);
    if (!product) {
      return res.status(404).render('404', { title: 'Sản phẩm không tồn tại' });
    }

    const relatedProducts = await dataService.getRelatedProducts(product);

    res.render('products/detail', {
      product,
      // relatedProducts,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
