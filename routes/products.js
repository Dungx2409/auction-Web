const express = require('express');
const { URLSearchParams } = require('url');
const router = express.Router();
const dataService = require('../services/dataService');
const hbsHelpers = require('../helpers/handlebars');
const { buildWatchSet, applyWatchStateToList, applyWatchStateToProduct } = require('../helpers/watchlist');

const PAGE_SIZE = 9;
const CLOSED_STATUSES = new Set(['ended', 'draft', 'removed', 'cancelled', 'suspended']);

function computeAuctionState(product) {
  const normalizedStatus = String(product.status || 'active').toLowerCase();
  const endTime = product.endDate ? new Date(product.endDate) : null;
  const validEndTime = endTime instanceof Date && !Number.isNaN(endTime.getTime());
  const closedByStatus = CLOSED_STATUSES.has(normalizedStatus);
  const closedBySchedule = validEndTime ? endTime.getTime() <= Date.now() : false;
  return {
    auctionClosed: Boolean(closedByStatus || closedBySchedule),
    auctionClosedReason: closedByStatus ? normalizedStatus : (closedBySchedule ? 'time' : null),
  };
}

function buildBidState(product, user) {
  const roles = resolveRoles(user);
  const isBidderRole = roles.includes('bidder');
  const ratingPlus = Number(user?.ratingPlus || 0);
  const ratingMinus = Number(user?.ratingMinus || 0);
  const ratingTotal = ratingPlus + ratingMinus;
  const ratingPercent = ratingTotal > 0 ? Math.round((ratingPlus / ratingTotal) * 100) : null;
  const allowUnratedBidders = Boolean(product.allowUnratedBidders ?? product.seller?.allowUnratedBidders ?? true);
  const meetsRatingRequirement = ratingPercent !== null && ratingPercent >= 80;
  const isUnratedBidder = ratingTotal === 0;
  const qualifiesByException = isBidderRole && isUnratedBidder && allowUnratedBidders;
  const requiresLogin = !user;
  const canBid = Boolean(user && isBidderRole && (meetsRatingRequirement || qualifiesByException));

  const numericCurrentPrice = Number(product.currentPrice);
  const startPrice = Number(product.startPrice);
  const numericBidStep = Number(product.bidStep ?? product.stepPrice);
  const hasCurrentPrice = Number.isFinite(numericCurrentPrice);
  const hasStartPrice = Number.isFinite(startPrice);
  const hasBidStep = Number.isFinite(numericBidStep) && numericBidStep > 0;
  const bidBase = hasCurrentPrice ? numericCurrentPrice : (hasStartPrice ? startPrice : 0);
  const suggestedBid = hasBidStep ? bidBase + numericBidStep : (hasCurrentPrice ? bidBase : null);
  const nextMinimumBid = hasBidStep ? bidBase + numericBidStep : bidBase;

  return {
    currentPrice: hasCurrentPrice ? numericCurrentPrice : null,
    suggestedBid,
    bidStep: hasBidStep ? numericBidStep : null,
    nextMinimumBid,
    bidBase,
    canBid,
    requiresLogin,
    showRatingNotice: Boolean(isBidderRole && !canBid && ratingPercent !== null),
    showExceptionNote: Boolean(qualifiesByException),
    ratingPercent,
    ratingPlus,
    ratingMinus,
    ratingRuleMessage: 'Cần có điểm đánh giá >= 80% để tham gia đấu giá.',
    needsConfirmation: true,
    isBidderRole,
    allowUnratedBidders,
  };
}

function resolveRoles(user) {
  if (!user) return [];
  if (Array.isArray(user.roles) && user.roles.length > 0) {
    return user.roles;
  }
  return user.role ? [user.role] : [];
}

const buildQaRedirect = (productId, params = {}) => {
  const query = new URLSearchParams(params);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return `/products/${productId}${suffix}#qa-thread`;
};

async function renderList(req, res, next, categoryId) {
  try {
    const { page = 1, sort = 'endingSoon' } = req.query;
    const pageNumber = Math.max(1, parseInt(page, 10) || 1);

    const results = await dataService.searchProducts(undefined, { sort, categoryId });
    // console.log('Search results:', results);
    const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
    const start = (pageNumber - 1) * PAGE_SIZE;
    const paged = results.slice(start, start + PAGE_SIZE);
    const watchSet = buildWatchSet(req.watchlistProductIds || req.currentUser?.watchlistIds);
    applyWatchStateToList(paged, watchSet);
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
    const watchSet = buildWatchSet(req.watchlistProductIds || req.currentUser?.watchlistIds);
    applyWatchStateToProduct(product, watchSet);
    applyWatchStateToList(relatedProducts, watchSet);
    const user = req.currentUser;
    const roles = resolveRoles(user);
    const isSellerOfProduct = Boolean(user?.id && String(product.seller?.id) === String(user.id));
    const { auctionClosed, auctionClosedReason } = computeAuctionState(product);
    const highestBidderId = product.highestBidder?.id ? String(product.highestBidder.id) : null;
    const isWinner = Boolean(auctionClosed && highestBidderId && user?.id && highestBidderId === String(user.id));

    if (auctionClosed && (isWinner || isSellerOfProduct)) {
      const order = await dataService.ensureOrderForProduct(product, { chatLimit: 100 });
      if (order) {
        const workflow = dataService.getOrderWorkflowMetadata();
        const currentIndex = workflow.findIndex((step) => step.status === order.status);
        const steps = workflow.map((step, index) => ({
          ...step,
          stepNumber: index + 1,
          isCurrent: step.status === order.status,
          isCompleted:
            order.status === dataService.ORDER_STATUSES.CANCELED_BY_SELLER
              ? false
              : currentIndex === -1
                ? false
                : index < currentIndex || step.status === dataService.ORDER_STATUSES.TRANSACTION_COMPLETED,
          isUpcoming:
            order.status !== dataService.ORDER_STATUSES.CANCELED_BY_SELLER && (currentIndex === -1 || index > currentIndex),
        }));

        const fulfillmentModel = {
          order,
          steps,
          isWinner,
          isSeller: isSellerOfProduct,
          flash: {
            success: req.query.fulfillSuccess || null,
            error: req.query.fulfillError || null,
          },
          focusTarget: req.query.focus || null,
          canSubmitPayment:
            isWinner && order.status === dataService.ORDER_STATUSES.AWAITING_PAYMENT_DETAILS,
          canSellerConfirmShipment:
            isSellerOfProduct && order.status === dataService.ORDER_STATUSES.PAYMENT_CONFIRMED_AWAITING_DELIVERY,
          canBuyerConfirmDelivery:
            isWinner && order.status === dataService.ORDER_STATUSES.DELIVERY_CONFIRMED_READY_TO_RATE,
          canCancelOrder: isSellerOfProduct && dataService.canSellerCancelOrder(order.status),
          showFeedbackForms:
            order.status === dataService.ORDER_STATUSES.TRANSACTION_COMPLETED && (isWinner || isSellerOfProduct),
          isCanceled: order.status === dataService.ORDER_STATUSES.CANCELED_BY_SELLER,
        };

        return res.render('products/fulfillment', {
          title: 'Hoàn tất đơn hàng',
          product,
          relatedProducts,
          fulfillment: fulfillmentModel,
          auctionClosed,
          auctionClosedReason,
        });
      }
    }

    const bidState = buildBidState(product, user);
    const bidContext = auctionClosed ? null : bidState;

    res.render('products/detail', {
      product,
      relatedProducts,
      canAskQuestion: Boolean(user && !isSellerOfProduct && roles.includes('bidder')),
      canAnswerQuestion: isSellerOfProduct,
      isAuthenticated: Boolean(user),
      bidContext,
      auctionClosed,
      auctionClosedReason,
      qaStatus: {
        error: req.query.qaError || null,
        success: req.query.qaSuccess || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/bids', async (req, res, next) => {
  try {
    const user = req.currentUser;
    if (!user?.id) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập để đặt giá.' });
    }

    const roles = resolveRoles(user);
    if (!roles.includes('bidder')) {
      return res.status(403).json({ error: 'Tài khoản của bạn chưa đủ quyền để đặt giá.' });
    }

    const rawProductId = Number(req.params.id);
    if (!Number.isFinite(rawProductId) || rawProductId <= 0) {
      return res.status(400).json({ error: 'Mã sản phẩm không hợp lệ.' });
    }

    const product = await dataService.getProductById(rawProductId, { includeBannedSeller: true });
    if (!product) {
      return res.status(404).json({ error: 'Sản phẩm không tồn tại.' });
    }

    if (String(product.seller?.id || '') === String(user.id)) {
      return res.status(400).json({ error: 'Bạn không thể đặt giá lên sản phẩm của chính mình.' });
    }

    const { auctionClosed } = computeAuctionState(product);
    if (auctionClosed) {
      return res.status(400).json({ error: 'Phiên đấu giá đã kết thúc. Bạn không thể tiếp tục đặt giá.' });
    }

    const bidState = buildBidState(product, user);
    if (!bidState.canBid) {
      const message = bidState.requiresLogin
        ? 'Vui lòng đăng nhập để đặt giá.'
        : 'Tài khoản của bạn chưa đủ điều kiện để đặt giá cho sản phẩm này.';
      return res.status(403).json({ error: message });
    }

    const normalizeAmount = (value) => {
      if (typeof value === 'number') return value;
      if (!value) return NaN;
      return Number(String(value).replace(/[^0-9]/g, ''));
    };

    const amount = normalizeAmount(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Số tiền đặt giá không hợp lệ.' });
    }

    const minBid = Number(bidState.nextMinimumBid || 0);
    if (Number.isFinite(minBid) && minBid > 0 && amount < minBid) {
      return res.status(400).json({ error: `Giá đặt tối thiểu hiện tại là ${hbsHelpers.formatCurrency(minBid)}.` });
    }

    const step = Number(bidState.bidStep || 0);
    const bidBase = Number.isFinite(bidState.bidBase) ? bidState.bidBase : (minBid && step ? minBid - step : 0);
    if (step > 0 && Number.isFinite(bidBase)) {
      const delta = amount - bidBase;
      if (delta % step !== 0) {
        return res.status(400).json({ error: 'Giá đặt phải tăng theo đúng bước giá đã quy định.' });
      }
    }

    await dataService.placeBid({
      productId: rawProductId,
      bidderId: user.id,
      amount,
    });

    const updatedProduct = await dataService.getProductById(rawProductId, { includeBannedSeller: true });
    const updatedBidState = buildBidState(updatedProduct, user);
    const leaderPlus = Number(updatedProduct.highestBidder?.ratingPlus || 0);
    const leaderMinus = Number(updatedProduct.highestBidder?.ratingMinus || 0);
    const leaderTotal = leaderPlus + leaderMinus;
    const leaderPercent = leaderTotal > 0 ? Math.round((leaderPlus / leaderTotal) * 100) : 0;
    const leaderDisplay = `${hbsHelpers.maskName(updatedProduct.highestBidder?.name || 'Ẩn danh')} (${leaderPercent}%)`;
    const latestBid = updatedProduct.bids?.[0] || null;

    return res.json({
      success: true,
      message: 'Đặt giá thành công!',
      product: {
        currentPrice: updatedProduct.currentPrice,
        currentPriceFormatted: hbsHelpers.formatCurrency(updatedProduct.currentPrice),
        suggestedBid: updatedBidState.suggestedBid,
        suggestedBidFormatted: updatedBidState.suggestedBid
          ? hbsHelpers.formatCurrency(updatedBidState.suggestedBid)
          : null,
        bidStep: updatedBidState.bidStep,
        nextMinimumBid: updatedBidState.nextMinimumBid,
        bidCount: updatedProduct.bidCount,
        leaderDisplay,
      },
      latestBid: latestBid
        ? {
            time: latestBid.time,
            timeText: hbsHelpers.formatDate(latestBid.time, 'DD/MM/YYYY HH:mm'),
            userName: hbsHelpers.maskName(latestBid.userName),
            amount: latestBid.amount,
            amountText: hbsHelpers.formatCurrency(latestBid.amount),
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/watchlist', async (req, res, next) => {
  try {
    const user = req.currentUser;
    if (!user?.id) {
      return res.status(401).json({ error: 'Bạn cần đăng nhập để dùng watch list.' });
    }

    const rawProductId = Number(req.params.id);
    if (!Number.isFinite(rawProductId) || rawProductId <= 0) {
      return res.status(400).json({ error: 'Mã sản phẩm không hợp lệ.' });
    }

    const product = await dataService.getProductById(rawProductId, { includeBannedSeller: true });
    if (!product) {
      return res.status(404).json({ error: 'Không tìm thấy sản phẩm.' });
    }

    const action = req.body?.action === 'remove' ? 'remove' : 'add';
    const result = action === 'remove'
      ? await dataService.removeFromWatchlist(user.id, rawProductId)
      : await dataService.addToWatchlist(user.id, rawProductId);

    return res.json({
      success: true,
      productId: String(rawProductId),
      isWatching: result.isWatching,
      watchers: result.watchers,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/questions', async (req, res, next) => {
  try {
    const productId = req.params.id;
    const user = req.currentUser;
    if (!user?.id) {
      const returnUrl = encodeURIComponent(req.originalUrl || `/products/${productId}`);
      return res.redirect(`/auth/login?returnUrl=${returnUrl}`);
    }

    const product = await dataService.getProductById(productId, { includeBannedSeller: true });
    if (!product) {
      return res.status(404).render('404', { title: 'Sản phẩm không tồn tại' });
    }

    const roles = resolveRoles(user);
    const isSeller = String(product.seller?.id || '') === String(user.id || '');
    const mode = req.body?.mode === 'seller' ? 'seller' : 'buyer';

    if (mode === 'seller') {
      if (!isSeller) {
        return res.redirect(buildQaRedirect(productId, { qaError: 'notSeller' }));
      }

      const sellerNote = (req.body?.comment || req.body?.question || '').trim();
      if (!sellerNote) {
        return res.redirect(buildQaRedirect(productId, { qaError: 'sellerEmpty' }));
      }

      await dataService.createQuestion({
        productId: product.id,
        buyerId: user.id,
        questionText: sellerNote,
      });

      return res.redirect(buildQaRedirect(productId, { qaSuccess: 'sellerNote' }));
    }

    if (isSeller) {
      return res.redirect(buildQaRedirect(productId, { qaError: 'owner' }));
    }

    if (!roles.includes('bidder')) {
      return res.redirect(buildQaRedirect(productId, { qaError: 'permission' }));
    }

    const questionText = (req.body?.question || '').trim();
    if (!questionText) {
      return res.redirect(buildQaRedirect(productId, { qaError: 'empty' }));
    }

    await dataService.createQuestion({
      productId: product.id,
      buyerId: user.id,
      questionText,
    });

    return res.redirect(buildQaRedirect(productId, { qaSuccess: 'question' }));
  } catch (error) {
    next(error);
  }
});

router.post('/:productId/questions/:questionId/answers', async (req, res, next) => {
  try {
    const { productId, questionId } = req.params;
    const user = req.currentUser;
    if (!user?.id) {
      const returnUrl = encodeURIComponent(req.originalUrl || `/products/${productId}`);
      return res.redirect(`/auth/login?returnUrl=${returnUrl}`);
    }

    const product = await dataService.getProductById(productId, { includeBannedSeller: true });
    if (!product) {
      return res.status(404).render('404', { title: 'Sản phẩm không tồn tại' });
    }

    const isSeller = String(product.seller?.id || '') === String(user.id || '');
    if (!isSeller) {
      return res.redirect(buildQaRedirect(productId, { qaError: 'notSeller' }));
    }

    const question = await dataService.getQuestionById(questionId);
    if (!question || String(question.productId) !== String(product.id)) {
      return res.redirect(buildQaRedirect(productId, { qaError: 'notfound' }));
    }

    const answerText = (req.body?.answer || '').trim();
    if (!answerText) {
      return res.redirect(buildQaRedirect(productId, { qaError: 'emptyAnswer' }));
    }

    await dataService.createAnswer({
      questionId: question.id,
      sellerId: user.id,
      answerText,
    });

    return res.redirect(buildQaRedirect(productId, { qaSuccess: 'answer' }));
  } catch (error) {
    next(error);
  }
});


module.exports = router;
