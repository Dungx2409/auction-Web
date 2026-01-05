const express = require('express');
const { URLSearchParams } = require('url');
const router = express.Router();
const dataService = require('../services/dataService');
const hbsHelpers = require('../helpers/handlebars');
const { buildWatchSet, applyWatchStateToList, applyWatchStateToProduct } = require('../helpers/watchlist');
const mailer = require('../services/mailer');

const PAGE_SIZE = 9;
const CLOSED_STATUSES = new Set(['ended', 'draft', 'removed', 'cancelled', 'suspended']);

/**
 * Send email notifications for auto-bid events
 * Only sends emails for important events:
 * - Outbid: when a bidder is ultimately outbid (final result only, not every step)
 * Does NOT spam seller for every auto-bid increment
 * 
 * @param {Object} params
 * @param {Object} params.autoBidResult - Result from processAutoBids
 * @param {Object} params.product - Product info (title, seller, etc.)
 * @param {string} params.productUrl - URL to the product
 * @param {Object} [params.originalBidder] - The bidder who triggered the auto-bid process
 * @param {number} [params.originalBidAmount] - The amount of the original bid
 */
async function sendAutoBidEmails({ autoBidResult, product, productUrl, originalBidder, originalBidAmount }) {
  if (!autoBidResult?.processed) return;

  const { outbidEvents, finalPrice } = autoBidResult;
  const finalWinnerId = autoBidResult.autoBid?.bidderId;

  // 1. Send outbid notifications - only to the final losers (not every step)
  // This is an important event - user needs to know they've been outbid
  if (outbidEvents && outbidEvents.length > 0) {
    // Find unique losers who are not the final winner
    const uniqueLosers = new Map();
    
    for (const event of outbidEvents) {
      // Only add if this bidder is not the final winner
      if (String(event.bidderId) !== String(finalWinnerId) && event.bidderEmail) {
        uniqueLosers.set(String(event.bidderId), event);
      }
    }

    // Send outbid email to each unique loser
    for (const [, loser] of uniqueLosers) {
      mailer.sendOutbidNotificationEmail({
        to: loser.bidderEmail,
        previousBidderName: loser.bidderName,
        productTitle: product.title,
        productUrl,
        newBidAmount: hbsHelpers.formatCurrency(finalPrice),
        yourBidAmount: hbsHelpers.formatCurrency(loser.previousAmount),
      }).catch((err) => {
        console.error('[mailer] Không thể gửi email thông báo bị vượt giá (auto-bid):', err);
      });
    }
  }

  // 2. If the original bidder got outbid by auto-bids, notify them
  // This is important - the person who just placed a bid needs to know they've been outbid
  if (originalBidder?.email && 
      originalBidder?.id && 
      String(originalBidder.id) !== String(finalWinnerId)) {
    mailer.sendOutbidNotificationEmail({
      to: originalBidder.email,
      previousBidderName: originalBidder.name,
      productTitle: product.title,
      productUrl,
      newBidAmount: hbsHelpers.formatCurrency(finalPrice),
      yourBidAmount: hbsHelpers.formatCurrency(originalBidAmount),
    }).catch((err) => {
      console.error('[mailer] Không thể gửi email thông báo bị vượt giá cho người đặt gốc:', err);
    });
  }

  // NOTE: We intentionally do NOT notify seller for every auto-bid increment
  // to avoid spam. Seller will receive summary when auction ends.
}

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
  const isSellerRole = roles.includes('seller');
  const canParticipate = isBidderRole || isSellerRole;
  const ratingPlus = Number(user?.ratingPlus || 0);
  const ratingMinus = Number(user?.ratingMinus || 0);
  const ratingTotal = ratingPlus + ratingMinus;
  const ratingPercent = ratingTotal > 0 ? Math.round((ratingPlus / ratingTotal) * 100) : null;
  const hasRatings = ratingTotal > 0;
  const meetsRatingRequirement = hasRatings && ratingPercent >= 80;
  const requestStatus = product?.bidRequest?.status || null;
  // Seller không cần approval, chỉ bidder mới cần
  const needsSellerApproval = isBidderRole && !isSellerRole && !hasRatings;
  const hasApproval = needsSellerApproval && requestStatus === 'approved';
  const isPendingApproval = needsSellerApproval && requestStatus === 'pending';
  const approvalDenied = needsSellerApproval && requestStatus === 'rejected';
  const canRequestApproval = needsSellerApproval && (!requestStatus || requestStatus === 'rejected');
  const requiresLogin = !user;
  // Seller luôn có thể đặt giá (không cần kiểm tra rating), bidder cần đủ điều kiện
  const canBid = Boolean(
    user &&
      canParticipate &&
      (isSellerRole || (hasRatings && meetsRatingRequirement) || (needsSellerApproval && hasApproval))
  );

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
    showRatingNotice: Boolean(isBidderRole && !isSellerRole && !needsSellerApproval && !canBid && ratingPercent !== null),
    ratingPercent,
    ratingPlus,
    ratingMinus,
    ratingRuleMessage: 'Cần có điểm đánh giá >= 80% để tham gia đấu giá.',
    needsConfirmation: true,
    isBidderRole,
    isSellerRole,
    canParticipate,
    needsApproval: needsSellerApproval,
    approvalStatus: requestStatus,
    pendingApproval: isPendingApproval,
    approvalDenied,
    canRequestApproval,
  };
}

function buildBuyNowState(product, user, options = {}) {
  const { auctionClosed = false, isSellerOfProduct = false, loginUrl = null } = options;
  const price = Number(product?.buyNowPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }
  if (auctionClosed) {
    return null;
  }

  const roles = resolveRoles(user);
  const isBidderRole = roles.includes('bidder');
  const isSellerRole = roles.includes('seller');
  const canParticipate = isBidderRole || isSellerRole;
  const requiresLogin = !user;
  const canBuy = Boolean(!requiresLogin && canParticipate && !isSellerOfProduct);
  let note = null;
  let disabledLabel = 'Không thể Mua ngay';

  if (!canBuy) {
    if (requiresLogin) {
      note = 'Đăng nhập để sử dụng tính năng Mua ngay.';
      disabledLabel = 'Đăng nhập để Mua ngay';
    } else if (isSellerOfProduct) {
      note = 'Bạn không thể mua sản phẩm do chính mình đăng bán.';
      disabledLabel = 'Bạn là người bán';
    } else if (!canParticipate) {
      note = 'Chỉ tài khoản bidder hoặc seller mới có thể sử dụng tính năng Mua ngay.';
      disabledLabel = 'Không dành cho vai trò hiện tại';
    }
  }

  return {
    price,
    priceFormatted: hbsHelpers.formatCurrency(price),
    canBuy,
    requiresLogin,
    note,
    disabledLabel,
    loginUrl: requiresLogin ? loginUrl : null,
  };
}

function resolveRoles(user) {
  if (!user) return [];
  if (Array.isArray(user.roles) && user.roles.length > 0) {
    return user.roles;
  }
  return user.role ? [user.role] : [];
}

function buildProductDetailUrl(req, productId) {
  const basePath = `/products/${productId}#qa-thread`;
  const host = req.get('host');
  const protocol = req.protocol || 'https';
  return host ? `${protocol}://${host}${basePath}` : basePath;
}

async function notifySellerAboutQuestion({ req, product, buyer, questionText }) {
  try {
    const sellerId = product?.seller?.id;
    if (!sellerId) return;
    const sellerUser = await dataService.getUserById(sellerId);
    if (!sellerUser?.email) return;
    const buyerName = buyer?.name || buyer?.email || 'Người mua';
    const productUrl = buildProductDetailUrl(req, product.id);
    await mailer.sendQuestionNotificationEmail({
      to: sellerUser.email,
      sellerName: sellerUser.name || product.seller?.name,
      productTitle: product.title,
      questionText,
      productUrl,
      askerName: buyerName,
    });
  } catch (error) {
    console.error('[mailer] Không thể gửi email thông báo câu hỏi:', error);
  }
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

    const searchResult = await dataService.searchProducts(undefined, { 
      sort, 
      categoryId,
      page: pageNumber,
      limit: PAGE_SIZE
    });
    
    const watchSet = buildWatchSet(req.watchlistProductIds || req.currentUser?.watchlistIds);
    applyWatchStateToList(searchResult.products, watchSet);
    const category = categoryId ? await dataService.getCategoryById(categoryId) : null;
    res.render('products/list', {
      products: searchResult.products,
      total: searchResult.total,
      page: searchResult.page,
      totalPages: searchResult.totalPages,
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
    const canParticipate = roles.includes('bidder') || roles.includes('seller');
    if (user?.id && canParticipate) {
      const bidRequest = await dataService.getBidRequest(product.id, user.id);
      if (bidRequest) {
        product.bidRequest = bidRequest;
      }
    }
    const isSellerOfProduct = Boolean(user?.id && String(product.seller?.id) === String(user.id));
    const { auctionClosed, auctionClosedReason } = computeAuctionState(product);
    const highestBidderId = product.highestBidder?.id ? String(product.highestBidder.id) : null;
    const isWinner = Boolean(auctionClosed && highestBidderId && user?.id && highestBidderId === String(user.id));

    if (auctionClosed && (isWinner || isSellerOfProduct)) {
      const order = await dataService.ensureOrderForProduct(product, { chatLimit: 100 });
      if (order) {
        // Send auction end notifications when order is first created
        if (order.isNewOrder) {
          const host = req.get('host') || 'localhost:3000';
          const protocol = req.protocol || 'http';
          const productUrl = `${protocol}://${host}/products/${product.id}`;
          const finalPrice = hbsHelpers.formatCurrency(product.currentPrice);

          // Send email to winner
          if (product.highestBidder?.email) {
            mailer.sendAuctionWonEmail({
              to: product.highestBidder.email,
              winnerName: product.highestBidder.name,
              productTitle: product.title,
              productUrl,
              finalPrice,
              sellerName: product.seller?.name,
            }).catch((err) => {
              console.error('[mailer] Không thể gửi email thông báo thắng đấu giá:', err);
            });
          }

          // Send email to seller
          if (product.seller?.email) {
            mailer.sendAuctionEndedForSellerEmail({
              to: product.seller.email,
              sellerName: product.seller.name,
              productTitle: product.title,
              productUrl,
              finalPrice,
              winnerName: hbsHelpers.maskName(product.highestBidder?.name || 'Người thắng'),
              bidCount: product.bidCount || 0,
            }).catch((err) => {
              console.error('[mailer] Không thể gửi email thông báo kết thúc đấu giá cho seller:', err);
            });
          }

          // Send email to losers (bidders with auto-bid who didn't win)
          // Note: We only have auto-bid info, not all bidders who manually bid
          const autoBids = await dataService.getAutoBidsForProduct(product.id);
          for (const autoBid of autoBids) {
            if (String(autoBid.bidderId) !== String(highestBidderId)) {
              // Get bidder email from the autoBid data
              const bidderEmail = autoBid.bidderEmail;
              if (bidderEmail) {
                mailer.sendAuctionLostEmail({
                  to: bidderEmail,
                  bidderName: autoBid.bidderName,
                  productTitle: product.title,
                  productUrl: `${protocol}://${host}/search`,
                  finalPrice,
                  yourBidAmount: hbsHelpers.formatCurrency(autoBid.maxPrice),
                }).catch((err) => {
                  console.error('[mailer] Không thể gửi email thông báo thua đấu giá:', err);
                });
              }
            }
          }
        }

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
    const originalUrl = req.originalUrl || req.url || `/products/${product.id}`;
    const loginUrl = `/auth/login?returnUrl=${encodeURIComponent(originalUrl)}`;
    const buyNowContext = buildBuyNowState(product, user, {
      auctionClosed,
      isSellerOfProduct,
      loginUrl,
    });

    // Lấy danh sách bidder đã bị từ chối (chỉ khi seller xem)
    let rejectedBidderIds = [];
    if (isSellerOfProduct) {
      const rejectedBidders = await dataService.getRejectedBiddersForProduct(product.id);
      rejectedBidderIds = rejectedBidders.map((r) => String(r.bidderId));
    }

    // Đánh dấu các bid của bidder bị từ chối
    if (product.bids && rejectedBidderIds.length > 0) {
      product.bids = product.bids.map((bid) => ({
        ...bid,
        isRejected: rejectedBidderIds.includes(String(bid.bidderId)),
      }));
    }

    res.render('products/detail', {
      product,
      relatedProducts,
      isSellerOfProduct,
      canAskQuestion: Boolean(user && !isSellerOfProduct && canParticipate),
      canAnswerQuestion: isSellerOfProduct,
      isAuthenticated: Boolean(user),
      bidContext,
      buyNowContext,
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
    const canParticipate = roles.includes('bidder') || roles.includes('seller');
    if (!canParticipate) {
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

    // Kiểm tra xem bidder có bị từ chối không
    const isRejected = await dataService.isBidderRejected(rawProductId, user.id);
    if (isRejected) {
      return res.status(403).json({ error: 'Bạn đã bị từ chối tham gia đấu giá sản phẩm này.' });
    }

    if (roles.includes('bidder')) {
      const bidRequest = await dataService.getBidRequest(product.id, user.id);
      if (bidRequest) {
        product.bidRequest = bidRequest;
      }
    }

    const { auctionClosed } = computeAuctionState(product);
    if (auctionClosed) {
      return res.status(400).json({ error: 'Phiên đấu giá đã kết thúc. Bạn không thể tiếp tục đặt giá.' });
    }

    const bidState = buildBidState(product, user);
    if (!bidState.canBid) {
      const message = bidState.requiresLogin
        ? 'Vui lòng đăng nhập để đặt giá.'
        : bidState.needsApproval && bidState.approvalStatus !== 'approved'
          ? 'Bạn cần người bán chấp thuận yêu cầu tham gia đấu giá trước khi đặt giá.'
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
      // Use tolerance for floating point comparison - ensure delta is a valid multiple of step
      const remainder = delta % step;
      const tolerance = 0.01; // Allow small floating point errors
      const isValidStep = remainder < tolerance || (step - remainder) < tolerance;
      if (delta < 0 || !isValidStep) {
        return res.status(400).json({ error: 'Giá đặt phải tăng theo đúng bước giá đã quy định.' });
      }
    }

    // Lưu thông tin người giữ giá trước đó để gửi email thông báo bị vượt giá
    const previousHighestBidder = product.highestBidder?.id ? { ...product.highestBidder } : null;
    const previousBidAmount = product.currentPrice;

    await dataService.placeBid({
      productId: rawProductId,
      bidderId: user.id,
      amount,
    });

    // Process auto-bids from other users and send notifications
    let autoBidResult = null;
    try {
      autoBidResult = await dataService.processAutoBids({
        productId: rawProductId,
        currentBidAmount: amount,
        currentBidderId: user.id,
      });
    } catch (autoBidError) {
      console.error('[auto-bid] Error processing auto-bids:', autoBidError);
    }

    const updatedProduct = await dataService.getProductById(rawProductId, { includeBannedSeller: true });
    const updatedBidState = buildBidState(updatedProduct, user);
    const leaderPlus = Number(updatedProduct.highestBidder?.ratingPlus || 0);
    const leaderMinus = Number(updatedProduct.highestBidder?.ratingMinus || 0);
    const leaderTotal = leaderPlus + leaderMinus;
    const leaderPercent = leaderTotal > 0 ? Math.round((leaderPlus / leaderTotal) * 100) : 0;
    const leaderDisplay = `${hbsHelpers.maskName(updatedProduct.highestBidder?.name || 'Ẩn danh')} (${leaderPercent}%)`;

    // Gửi email thông báo cho các bên liên quan
    const host = req.get('host') || 'localhost:3000';
    const protocol = req.protocol || 'http';
    const productUrl = `${protocol}://${host}/products/${rawProductId}`;
    const formattedAmount = hbsHelpers.formatCurrency(amount);

    // Gửi email cho auto-bid events (outbid notifications, seller notification)
    if (autoBidResult?.processed) {
      sendAutoBidEmails({ 
        autoBidResult, 
        product, 
        productUrl,
        originalBidder: { id: user.id, name: user.name, email: user.email },
        originalBidAmount: amount,
      }).catch((err) => {
        console.error('[auto-bid] Error sending auto-bid emails:', err);
      });
    }

    // 1. Gửi email cho người đặt giá (bidder) - xác nhận đặt giá thành công
    if (user.email) {
      mailer.sendBidSuccessEmail({
        to: user.email,
        bidderName: user.name,
        productTitle: product.title,
        productUrl,
        bidAmount: formattedAmount,
      }).catch((err) => {
        console.error('[mailer] Không thể gửi email xác nhận đặt giá cho bidder:', err);
      });
    }

    // 2. Gửi email cho người bán (seller) - thông báo có người đặt giá mới
    // Chỉ gửi nếu không có auto-bid xảy ra (tránh gửi 2 email liên tiếp)
    // Nếu có auto-bid, sendAutoBidEmails đã gửi email với kết quả cuối cùng
    if (product.seller?.email && !autoBidResult?.processed) {
      mailer.sendBidNotificationToSeller({
        to: product.seller.email,
        sellerName: product.seller.name,
        productTitle: product.title,
        productUrl,
        bidderName: hbsHelpers.maskName(user.name),
        bidAmount: formattedAmount,
        bidCount: updatedProduct.bidCount,
      }).catch((err) => {
        console.error('[mailer] Không thể gửi email thông báo đặt giá cho seller:', err);
      });
    }

    // 3. Gửi email cho người giữ giá trước đó (nếu có và khác người đặt giá mới)
    if (previousHighestBidder?.id && 
        String(previousHighestBidder.id) !== String(user.id) && 
        previousHighestBidder.email) {
      mailer.sendOutbidNotificationEmail({
        to: previousHighestBidder.email,
        previousBidderName: previousHighestBidder.name,
        productTitle: product.title,
        productUrl,
        newBidAmount: formattedAmount,
        yourBidAmount: hbsHelpers.formatCurrency(previousBidAmount),
      }).catch((err) => {
        console.error('[mailer] Không thể gửi email thông báo bị vượt giá:', err);
      });
    }
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

// ========== Auto-Bid Routes ==========

// Get current auto-bid setting
router.get('/:id/auto-bid', async (req, res, next) => {
  try {
    const user = req.currentUser;
    if (!user?.id) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập.' });
    }

    const productId = Number(req.params.id);
    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Mã sản phẩm không hợp lệ.' });
    }

    const autoBid = await dataService.getAutoBid(productId, user.id);
    return res.json({
      hasAutoBid: Boolean(autoBid),
      autoBid: autoBid ? {
        maxPrice: autoBid.maxPrice,
        maxPriceFormatted: hbsHelpers.formatCurrency(autoBid.maxPrice),
        createdAt: autoBid.createdAt,
      } : null,
    });
  } catch (error) {
    next(error);
  }
});

// Set or update auto-bid
router.post('/:id/auto-bid', async (req, res, next) => {
  try {
    const user = req.currentUser;
    if (!user?.id) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập để đặt giá tự động.' });
    }

    const roles = resolveRoles(user);
    const canParticipate = roles.includes('bidder') || roles.includes('seller');
    if (!canParticipate) {
      return res.status(403).json({ error: 'Chỉ tài khoản bidder hoặc seller mới được phép đặt giá tự động.' });
    }

    const productId = Number(req.params.id);
    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Mã sản phẩm không hợp lệ.' });
    }

    // Check if bidder is rejected
    const isRejected = await dataService.isBidderRejected(productId, user.id);
    if (isRejected) {
      return res.status(403).json({ error: 'Bạn đã bị từ chối tham gia đấu giá sản phẩm này.' });
    }

    // Get product for validation
    const product = await dataService.getProductById(productId, { includeBannedSeller: true });
    if (!product) {
      return res.status(404).json({ error: 'Không tìm thấy sản phẩm.' });
    }

    // Check if product requires bid request
    if (product.requireBidApproval) {
      const bidRequest = await dataService.getBidRequest(productId, user.id);
      if (!bidRequest || bidRequest.status !== 'approved') {
        return res.status(403).json({ 
          error: 'Sản phẩm này yêu cầu duyệt trước khi đấu giá. Vui lòng gửi yêu cầu tham gia.',
          requiresApproval: true,
        });
      }
    }

    const normalizeAmount = (value) => {
      if (typeof value === 'number') return value;
      if (!value) return NaN;
      return Number(String(value).replace(/[^0-9]/g, ''));
    };

    const maxPrice = normalizeAmount(req.body?.maxPrice);
    if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
      return res.status(400).json({ error: 'Giá tối đa không hợp lệ.' });
    }

    // Calculate minimum required
    const currentPrice = Number(product.currentPrice || product.startPrice || 0);
    const bidStep = Number(product.bidStep || 0);
    const minRequired = product.bidCount > 0 ? currentPrice + bidStep : currentPrice;

    if (maxPrice < minRequired) {
      return res.status(400).json({ 
        error: `Giá tối đa phải ít nhất ${hbsHelpers.formatCurrency(minRequired)}.`,
        minRequired,
      });
    }

    // Set auto-bid
    const result = await dataService.setAutoBid({
      productId,
      bidderId: user.id,
      maxPrice,
    });

    // Build product URL for emails
    const host = req.get('host') || 'localhost:3000';
    const protocol = req.protocol || 'http';
    const productUrl = `${protocol}://${host}/products/${productId}`;

    // If user doesn't have the current highest bid, place an initial bid
    const isCurrentLeader = product.highestBidder?.id && String(product.highestBidder.id) === String(user.id);
    let initialBidPlaced = false;
    let newBidAmount = null;

    if (!isCurrentLeader) {
      // Place initial bid at minimum price
      const initialBid = product.bidCount > 0 ? currentPrice + bidStep : currentPrice;
      
      if (initialBid <= maxPrice) {
        try {
          // Store previous leader for outbid notification
          const previousHighestBidder = product.highestBidder?.id ? { ...product.highestBidder } : null;
          const previousBidAmount = product.currentPrice;

          await dataService.placeBid({
            productId,
            bidderId: user.id,
            amount: initialBid,
          });
          initialBidPlaced = true;
          newBidAmount = initialBid;

          // Send email to user confirming their initial bid
          if (user.email) {
            mailer.sendBidSuccessEmail({
              to: user.email,
              bidderName: user.name,
              productTitle: product.title,
              productUrl,
              bidAmount: hbsHelpers.formatCurrency(initialBid),
            }).catch((err) => {
              console.error('[mailer] Không thể gửi email xác nhận đặt giá tự động:', err);
            });
          }

          // Send outbid notification to previous leader (if any and different from current user)
          if (previousHighestBidder?.id && 
              String(previousHighestBidder.id) !== String(user.id) && 
              previousHighestBidder.email) {
            mailer.sendOutbidNotificationEmail({
              to: previousHighestBidder.email,
              previousBidderName: previousHighestBidder.name,
              productTitle: product.title,
              productUrl,
              newBidAmount: hbsHelpers.formatCurrency(initialBid),
              yourBidAmount: hbsHelpers.formatCurrency(previousBidAmount),
            }).catch((err) => {
              console.error('[mailer] Không thể gửi email thông báo bị vượt giá:', err);
            });
          }

          // Process other auto-bids in response
          const autoBidResult = await dataService.processAutoBids({
            productId,
            currentBidAmount: initialBid,
            currentBidderId: user.id,
          });

          if (autoBidResult.processed && autoBidResult.autoBid) {
            newBidAmount = autoBidResult.autoBid.amount;
            
            // Send email notifications for auto-bid events
            sendAutoBidEmails({ 
              autoBidResult, 
              product, 
              productUrl,
              originalBidder: { id: user.id, name: user.name, email: user.email },
              originalBidAmount: initialBid,
            }).catch((err) => {
              console.error('[auto-bid] Error sending auto-bid emails:', err);
            });
          } else {
            // No auto-bid occurred, send notification to seller about the initial bid
            if (product.seller?.email) {
              mailer.sendBidNotificationToSeller({
                to: product.seller.email,
                sellerName: product.seller.name,
                productTitle: product.title,
                productUrl,
                bidderName: hbsHelpers.maskName(user.name),
                bidAmount: hbsHelpers.formatCurrency(initialBid),
                bidCount: (product.bidCount || 0) + 1,
              }).catch((err) => {
                console.error('[mailer] Không thể gửi email thông báo đặt giá tự động cho seller:', err);
              });
            }
          }
        } catch (bidError) {
          console.error('[auto-bid] Error placing initial bid:', bidError);
        }
      }
    }

    // Get updated product state
    const updatedProduct = await dataService.getProductById(productId, { includeBannedSeller: true });
    const updatedBidState = buildBidState(updatedProduct, user);

    return res.json({
      success: true,
      message: initialBidPlaced 
        ? 'Đã thiết lập đấu giá tự động và đặt giá khởi đầu!' 
        : 'Đã thiết lập đấu giá tự động!',
      autoBid: {
        maxPrice: result.maxPrice,
        maxPriceFormatted: hbsHelpers.formatCurrency(result.maxPrice),
      },
      initialBidPlaced,
      product: {
        currentPrice: updatedProduct.currentPrice,
        currentPriceFormatted: hbsHelpers.formatCurrency(updatedProduct.currentPrice),
        bidCount: updatedProduct.bidCount,
        nextMinimumBid: updatedBidState.nextMinimumBid,
      },
    });
  } catch (error) {
    if (error.code === 'AUCTION_NOT_ACTIVE' || error.code === 'AUCTION_ENDED') {
      return res.status(400).json({ error: 'Phiên đấu giá đã kết thúc.' });
    }
    if (error.code === 'CANNOT_BID_OWN_PRODUCT') {
      return res.status(403).json({ error: 'Bạn không thể đấu giá sản phẩm của chính mình.' });
    }
    next(error);
  }
});

// Remove auto-bid
router.delete('/:id/auto-bid', async (req, res, next) => {
  try {
    const user = req.currentUser;
    if (!user?.id) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập.' });
    }

    const productId = Number(req.params.id);
    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Mã sản phẩm không hợp lệ.' });
    }

    const removed = await dataService.removeAutoBid(productId, user.id);
    return res.json({
      success: true,
      removed,
      message: removed ? 'Đã hủy đấu giá tự động.' : 'Không có thiết lập đấu giá tự động nào.',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/buy-now', async (req, res, next) => {
  try {
    const user = req.currentUser;
    if (!user?.id) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập để sử dụng tính năng Mua ngay.' });
    }

    const roles = resolveRoles(user);
    const canParticipate = roles.includes('bidder') || roles.includes('seller');
    if (!canParticipate) {
      return res.status(403).json({ error: 'Chỉ tài khoản bidder hoặc seller mới được phép Mua ngay.' });
    }

    const productId = Number(req.params.id);
    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Mã sản phẩm không hợp lệ.' });
    }

    const result = await dataService.buyProductNow({ productId, buyerId: user.id });
    const successNote = encodeURIComponent('Đã mua ngay thành công. Hãy hoàn tất thông tin thanh toán nhé!');
    const redirectUrl = `/products/${productId}?focus=step-payment&fulfillSuccess=${successNote}`;

    return res.json({
      success: true,
      orderId: result.orderId,
      redirectUrl,
    });
  } catch (error) {
    const friendlyMessages = {
      BUY_NOW_INVALID_INPUT: 'Thiếu thông tin để Mua ngay.',
      BUY_NOW_PRODUCT_NOT_FOUND: 'Sản phẩm không tồn tại hoặc đã bị gỡ.',
      BUY_NOW_SELF_PURCHASE: 'Bạn không thể mua sản phẩm của chính mình.',
      BUY_NOW_NOT_AVAILABLE: 'Sản phẩm đã kết thúc hoặc không còn hỗ trợ Mua ngay.',
      BUY_NOW_NOT_CONFIGURED: 'Người bán chưa bật giá Mua ngay cho sản phẩm này.',
      BUY_NOW_ALREADY_COMPLETED: 'Sản phẩm đã có người chốt mua trước đó.',
    };

    if (error.code && friendlyMessages[error.code]) {
      const statusMap = {
        BUY_NOW_PRODUCT_NOT_FOUND: 404,
        BUY_NOW_ALREADY_COMPLETED: 409,
      };
      const status = statusMap[error.code] || 400;
      return res.status(status).json({ error: friendlyMessages[error.code] });
    }

    next(error);
  }
});

router.post('/:id/bid-requests', async (req, res, next) => {
  try {
    const user = req.currentUser;
    if (!user?.id) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập để gửi yêu cầu tham gia đấu giá.' });
    }

    const roles = resolveRoles(user);
    if (!roles.includes('bidder')) {
      return res.status(403).json({ error: 'Chỉ tài khoản bidder mới có thể gửi yêu cầu.' });
    }

    const ratingPlus = Number(user.ratingPlus || 0);
    const ratingMinus = Number(user.ratingMinus || 0);
    if (ratingPlus + ratingMinus > 0) {
      return res.status(400).json({ error: 'Tính năng này chỉ dành cho tài khoản chưa có đánh giá.' });
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
      return res.status(400).json({ error: 'Bạn không cần gửi yêu cầu cho sản phẩm của chính mình.' });
    }

    const message = req.body?.message || '';
    const result = await dataService.createBidRequest({
      productId: rawProductId,
      bidderId: user.id,
      message,
    });

    // Gửi email thông báo cho seller nếu yêu cầu mới được tạo hoặc gửi lại
    if (result.created || result.updated) {
      const sellerEmail = product.seller?.email;
      if (sellerEmail) {
        const host = req.get('host') || 'localhost:3000';
        const protocol = req.protocol || 'http';
        const productUrl = `${protocol}://${host}/account/products`;
        
        mailer.sendBidRequestNotificationEmail({
          to: sellerEmail,
          sellerName: product.seller?.name,
          bidderName: user.name,
          bidderEmail: user.email,
          productTitle: product.title,
          productUrl,
          message,
        }).catch((err) => {
          console.error('[mailer] Không thể gửi email thông báo yêu cầu đấu giá:', err);
        });
      }
    }

    return res.json({
      success: true,
      status: result.status,
      request: result.request,
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

    const canParticipate = roles.includes('bidder') || roles.includes('seller');
    if (!canParticipate) {
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

    notifySellerAboutQuestion({ req, product, buyer: user, questionText });

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

// Seller từ chối bidder - không cho đấu giá sản phẩm này nữa
router.post('/:id/reject-bidder', async (req, res, next) => {
  try {
    const user = req.currentUser;
    if (!user?.id) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập.' });
    }

    const roles = resolveRoles(user);
    if (!roles.includes('seller')) {
      return res.status(403).json({ error: 'Chỉ người bán mới có quyền thực hiện thao tác này.' });
    }

    const productId = Number(req.params.id);
    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Mã sản phẩm không hợp lệ.' });
    }

    const bidderId = Number(req.body?.bidderId);
    if (!Number.isFinite(bidderId) || bidderId <= 0) {
      return res.status(400).json({ error: 'Mã người mua không hợp lệ.' });
    }

    const reason = req.body?.reason || '';

    const result = await dataService.rejectBidder({
      productId,
      bidderId,
      sellerId: user.id,
      reason,
    });

    if (result.alreadyRejected) {
      return res.json({
        success: true,
        message: 'Người mua này đã bị từ chối trước đó.',
        alreadyRejected: true,
      });
    }

    // Gửi email thông báo cho bidder bị từ chối
    if (result.rejectedBidder?.email) {
      const host = req.get('host') || 'localhost:3000';
      const protocol = req.protocol || 'http';
      const productUrl = `${protocol}://${host}/products/${productId}`;

      mailer.sendBidRequestResponseEmail({
        to: result.rejectedBidder.email,
        bidderName: result.rejectedBidder.name,
        productTitle: result.productTitle,
        productUrl,
        approved: false,
        sellerNote: reason || 'Người bán đã từ chối quyền đấu giá của bạn cho sản phẩm này.',
      }).catch((err) => {
        console.error('[mailer] Không thể gửi email thông báo từ chối bidder:', err);
      });
    }

    // Nếu bidder bị từ chối đang là người cao nhất, thông báo cho người kế tiếp
    if (result.wasHighestBidder && result.newHighestBidder?.email) {
      const host = req.get('host') || 'localhost:3000';
      const protocol = req.protocol || 'http';
      const productUrl = `${protocol}://${host}/products/${productId}`;

      mailer.sendBidSuccessEmail({
        to: result.newHighestBidder.email,
        bidderName: result.newHighestBidder.name,
        productTitle: result.productTitle,
        productUrl,
        bidAmount: hbsHelpers.formatCurrency(result.newHighestBidder.bidAmount),
      }).catch((err) => {
        console.error('[mailer] Không thể gửi email thông báo người dẫn đầu mới:', err);
      });
    }

    return res.json({
      success: true,
      message: result.wasHighestBidder
        ? 'Đã từ chối người mua. Giá sản phẩm đã được cập nhật cho người đặt giá cao thứ nhì.'
        : 'Đã từ chối người mua. Họ không thể đấu giá sản phẩm này nữa.',
      wasHighestBidder: result.wasHighestBidder,
      newHighestBidder: result.newHighestBidder ? {
        name: hbsHelpers.maskName(result.newHighestBidder.name),
        bidAmount: hbsHelpers.formatCurrency(result.newHighestBidder.bidAmount),
      } : null,
    });
  } catch (error) {
    if (error.code === 'PRODUCT_NOT_FOUND') {
      return res.status(404).json({ error: 'Sản phẩm không tồn tại.' });
    }
    if (error.code === 'NOT_PRODUCT_OWNER') {
      return res.status(403).json({ error: 'Bạn không phải là chủ sản phẩm này.' });
    }
    next(error);
  }
});

// Hoàn tác từ chối bidder
router.post('/:id/unreject-bidder', async (req, res, next) => {
  try {
    const user = req.currentUser;
    if (!user?.id) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập.' });
    }

    const roles = resolveRoles(user);
    if (!roles.includes('seller')) {
      return res.status(403).json({ error: 'Chỉ người bán mới có quyền thực hiện thao tác này.' });
    }

    const productId = Number(req.params.id);
    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Mã sản phẩm không hợp lệ.' });
    }

    const bidderId = Number(req.body?.bidderId);
    if (!Number.isFinite(bidderId) || bidderId <= 0) {
      return res.status(400).json({ error: 'Mã người mua không hợp lệ.' });
    }

    const result = await dataService.unrejectBidder({
      productId,
      bidderId,
      sellerId: user.id,
    });

    if (result.notFound) {
      return res.json({
        success: true,
        message: 'Người mua này chưa bị từ chối.',
        notFound: true,
      });
    }

    // Gửi email thông báo cho bidder được hoàn tác
    if (result.bidder?.email) {
      const host = req.get('host') || 'localhost:3000';
      const protocol = req.protocol || 'http';
      const productUrl = `${protocol}://${host}/products/${productId}`;

      mailer.sendBidRequestResponseEmail({
        to: result.bidder.email,
        bidderName: result.bidder.name,
        productTitle: result.productTitle,
        productUrl,
        approved: true,
        sellerNote: 'Người bán đã cho phép bạn tiếp tục tham gia đấu giá sản phẩm này.',
      }).catch((err) => {
        console.error('[mailer] Không thể gửi email thông báo hoàn tác từ chối:', err);
      });
    }

    return res.json({
      success: true,
      message: 'Đã hoàn tác từ chối. Người mua có thể tiếp tục đấu giá sản phẩm này.',
    });
  } catch (error) {
    if (error.code === 'PRODUCT_NOT_FOUND') {
      return res.status(404).json({ error: 'Sản phẩm không tồn tại.' });
    }
    if (error.code === 'NOT_PRODUCT_OWNER') {
      return res.status(403).json({ error: 'Bạn không phải là chủ sản phẩm này.' });
    }
    next(error);
  }
});


module.exports = router;
