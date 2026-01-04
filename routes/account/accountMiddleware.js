const dayjs = require('dayjs');
const dataService = require('../../services/dataService');
const { ORDER_STATUSES } = require('../../services/orderService');
const { buildWatchSet, applyWatchStateToList, applyWatchStateToProduct } = require('../../helpers/watchlist');

function resolveRoles(user) {
  if (!user) return [];
  if (Array.isArray(user.roles) && user.roles.length > 0) {
    return user.roles;
  }
  return user.role ? [user.role] : [];
}

function flattenCategories(tree = [], depth = 0) {
  const items = [];
  tree.forEach((node) => {
    items.push({
      id: node.id,
      name: `${depth > 0 ? `${'--'.repeat(depth)} ` : ''}${node.name}`,
    });
    if (node.children && node.children.length) {
      items.push(...flattenCategories(node.children, depth + 1));
    }
  });
  return items;
}

function buildSellerProductFormDefaults(categories = []) {
  const start = dayjs().add(1, 'hour');
  const end = dayjs().add(3, 'day');
  return {
    title: '',
    shortDescription: '',
    fullDescription: '',
    categoryId: categories[0]?.id || '',
    startPrice: '',
    stepPrice: '',
    buyNowPrice: '',
    startDate: start.format('YYYY-MM-DDTHH:mm'),
    endDate: end.format('YYYY-MM-DDTHH:mm'),
    imageUrl: '',
    autoExtend: true,
  };
}

async function buildBidderContext(user, watchSet) {
  const [watchlistItems, bidderProducts, wonProducts, recommendedSource, ratingHistory, upgradeRequest] = await Promise.all([
    dataService.getWatchlistForUser(user.id),
    dataService.getProductsByBidder(user.id),
    dataService.getProductsWonByBidder(user.id),
    dataService.getProductsEndingSoon(8),
    dataService.getRatingsReceivedByUser(user.id, { limit: 10 }),
    dataService.getUpgradeRequestByUser(user.id),
  ]);

  const normalizeStatus = (status) => String(status || '').toLowerCase();
  const now = dayjs();
  const activeBids = bidderProducts
    .filter((product) => {
      const isActive = normalizeStatus(product.status) === 'active';
      if (!isActive) return false;
      if (!product.endDate) return true;
      const end = dayjs(product.endDate);
      return end.isAfter(now);
    })
    .sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
  const wins = (wonProducts || []).slice().sort((a, b) => new Date(b.endDate) - new Date(a.endDate));

  const recommended = recommendedSource.filter((product) => !wins.some((win) => win.id === product.id));
  const enrichedWatchlist = watchlistItems.map((entry) => ({
    ...entry,
    product: applyWatchStateToProduct(entry.product, watchSet),
  }));

  applyWatchStateToList(activeBids, watchSet);
  applyWatchStateToList(wins, watchSet);
  applyWatchStateToList(recommended, watchSet);

  const annotateBidStatus = (items = []) =>
    items.map((product) => {
      const hasBid = product?.myBid != null;
      const isLeading =
        hasBid && product?.highestBidder?.id && String(product.highestBidder.id) === String(user.id);
      return {
        ...product,
        bidStatus: isLeading ? 'leading' : hasBid ? 'outbid' : 'watching',
      };
    });

  const activeBidsWithStatus = annotateBidStatus(activeBids);

  const ratingPositive = Number(user?.ratingPlus ?? user?.rating_pos ?? 0);
  const ratingNegative = Number(user?.ratingMinus ?? user?.rating_neg ?? 0);
  const ratingTotal = ratingPositive + ratingNegative;
  const ratingScore = ratingTotal > 0 ? Math.round((ratingPositive / ratingTotal) * 100) : null;

  return {
    watchlist: enrichedWatchlist,
    activeBids: activeBidsWithStatus,
    wins,
    recommended,
    ratings: {
      summary: {
        positive: ratingPositive,
        negative: ratingNegative,
        total: ratingTotal,
        scorePercent: ratingScore,
      },
      history: ratingHistory,
    },
    upgradeRequest,
  };
}

async function buildSellerContext(user, watchSet, extras) {
  const [activeProducts, endedProducts, draftProducts, settings, categories, bidRequests] = await Promise.all([
    dataService.getProductsBySeller(user.id, { status: 'active', includeOrders: true }),
    dataService.getProductsBySeller(user.id, { status: ['ended'], includeOrders: true }),
    dataService.getProductsBySeller(user.id, { status: ['draft'] }),
    dataService.getSettings(),
    dataService.getCategories(),
    dataService.getBidRequestsBySeller(user.id, { status: 'pending' }),
  ]);

  const flattenedCategories = flattenCategories(categories);
  const defaultForm = buildSellerProductFormDefaults(flattenedCategories);
  const sellerExtras = extras.seller || {};
  const providedForm = sellerExtras.productForm || {};

  applyWatchStateToList(activeProducts, watchSet);
  applyWatchStateToList(endedProducts, watchSet);
  applyWatchStateToList(draftProducts, watchSet);

  const confirmedOrderStatuses = new Set([
    ORDER_STATUSES.PAYMENT_CONFIRMED_AWAITING_DELIVERY,
    ORDER_STATUSES.DELIVERY_CONFIRMED_READY_TO_RATE,
    ORDER_STATUSES.TRANSACTION_COMPLETED,
  ]
    .filter(Boolean)
    .map((status) => String(status).toLowerCase()));

  const now = dayjs();

  const partitionByOrder = (productsList = []) => {
    const selling = [];
    const sold = [];
    productsList.forEach((product) => {
      const status = String(product.status || '').toLowerCase();
      const orderStatus = product.order ? String(product.order.status || '').toLowerCase() : '';
      const hasConfirmedPayment = Boolean(orderStatus && confirmedOrderStatuses.has(orderStatus));
      const productMarkedSold = status === 'sold' || status === 'transaction_completed';
      const auctionEnded = Boolean(product.endDate && dayjs(product.endDate).isBefore(now));
      product.auctionEnded = auctionEnded;
      if (hasConfirmedPayment || productMarkedSold) {
        sold.push(product);
      } else {
        selling.push(product);
      }
    });
    return { selling, sold };
  };

  const activePartitions = partitionByOrder(activeProducts);
  const endedPartitions = partitionByOrder(endedProducts);

  const mergedSelling = [...activePartitions.selling, ...endedPartitions.selling];
  const mergedSold = [...activePartitions.sold, ...endedPartitions.sold];

  return {
    sellingProducts: mergedSelling,
    soldProducts: mergedSold,
    activeProducts: mergedSelling,
    endedProducts: mergedSold,
    draftProducts,
    bidRequests,
    autoExtendSettings: settings.autoExtend,
    categories: flattenedCategories,
    stats: {
      active: mergedSelling.length,
      sold: mergedSold.length,
      draft: draftProducts.length,
    },
    productForm: {
      ...defaultForm,
      ...providedForm,
      autoExtend: providedForm.autoExtend ?? defaultForm.autoExtend,
    },
    productErrors: sellerExtras.productErrors || {},
    productFlash: sellerExtras.productFlash || null,
    editingProductId: sellerExtras.editingProductId || null,
    editingProductTitle: sellerExtras.editingProductTitle || null,
  };
}

async function buildAdminContext() {
  const [products, categories, categoriesForAdmin, parentCategories, users, pendingUpgradeRequests, upgradeRequestCounts] = await Promise.all([
    dataService.getProducts(),
    dataService.getCategories(),
    dataService.getCategoriesForAdmin(),
    dataService.getParentCategories(),
    dataService.getUsers(),
    dataService.getPendingUpgradeRequests(),
    dataService.getUpgradeRequestCounts(),
  ]);

  const roleCounts = users.reduce(
    (acc, entry) => {
      const role = String(entry.role || '').toLowerCase();
      acc.all += 1;
      if (role === 'admin') {
        acc.admin += 1;
      } else if (role === 'seller') {
        acc.seller += 1;
      } else {
        acc.bidder += 1;
      }
      return acc;
    },
    { all: 0, admin: 0, seller: 0, bidder: 0 }
  );

  const totalCategories = categories.reduce((sum, category) => {
    const childrenCount = Array.isArray(category.children) ? category.children.length : 0;
    return sum + 1 + childrenCount;
  }, 0);

  return {
    stats: {
      totalProducts: products.length,
      totalCategories,
      totalUsers: users.length,
      pendingUpgradeRequests: upgradeRequestCounts.pending || 0,
    },
    categories,
    categoriesForAdmin,
    parentCategories,
    users,
    recentProducts: products.slice(0, 8),
    userCounts: roleCounts,
    upgradeRequests: pendingUpgradeRequests,
    upgradeRequestCounts,
  };
}

async function buildAccountContext(user, extras = {}) {
  const roles = resolveRoles(user);
  const isBidder = roles.includes('bidder');
  const isSeller = roles.includes('seller');
  const isAdmin = roles.includes('admin');
  const hasWatchlist = isBidder || isSeller;
  const watchSet = buildWatchSet(user?.watchlistIds);

  // Check if this is a newly upgraded seller who hasn't seen the notification
  let showUpgradeSuccessNotification = false;
  if (isSeller && user) {
    showUpgradeSuccessNotification = await dataService.hasUnseenUpgradeNotification(user.id);
  }

  const context = {
    title: 'Tài khoản của tôi',
    user,
    roles,
    isBidder,
    isSeller,
    isAdmin,
    hasWatchlist,
    showUpgradeSuccessNotification,
  };

  if (isBidder && user) {
    context.bidder = await buildBidderContext(user, watchSet);
  }

  // Seller also gets bidder context for participating in auctions
  if (isSeller && user && !context.bidder) {
    context.bidder = await buildBidderContext(user, watchSet);
  }

  if (isSeller && user) {
    context.seller = await buildSellerContext(user, watchSet, extras);
    if (!context.bidder) {
      const sellerWatchlist = await dataService.getWatchlistForUser(user.id);
      context.seller.watchlist = sellerWatchlist.map((entry) => ({
        ...entry,
        product: applyWatchStateToProduct(entry.product, watchSet),
      }));
    } else {
      context.seller.watchlist = context.bidder.watchlist;
    }
  } else if (extras.seller) {
    context.seller = { ...(extras.seller || {}) };
  }

  let ratingSnapshot = context.bidder?.ratings || context.seller?.ratings || null;
  const shouldHaveRatings = (isBidder || isSeller) && user;

  if (!ratingSnapshot && shouldHaveRatings) {
    const ratingHistory = await dataService.getRatingsReceivedByUser(user.id, { limit: 10 });
    const ratingPositive = Number(user?.ratingPlus ?? user?.rating_pos ?? 0);
    const ratingNegative = Number(user?.ratingMinus ?? user?.rating_neg ?? 0);
    const ratingTotal = ratingPositive + ratingNegative;
    const ratingScore = ratingTotal > 0 ? Math.round((ratingPositive / ratingTotal) * 100) : null;

    ratingSnapshot = {
      summary: {
        positive: ratingPositive,
        negative: ratingNegative,
        total: ratingTotal,
        scorePercent: ratingScore,
      },
      history: ratingHistory || [],
    };
  }

  if (ratingSnapshot) {
    context.accountRatings = ratingSnapshot;
    if (context.bidder) {
      context.bidder.ratings = ratingSnapshot;
    }
    if (context.seller) {
      context.seller.ratings = ratingSnapshot;
    }
  }

  if (isAdmin) {
    context.admin = await buildAdminContext();
  }

  const defaultProfileForm = {
    name: user?.name || '',
    email: user?.email || '',
    address: user?.address || '',
  };

  context.profileForm = { ...defaultProfileForm, ...(extras.profileForm || {}) };
  context.profileErrors = extras.profileErrors || {};
  context.profileFlash = extras.profileFlash || null;

  context.passwordForm = {
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    ...(extras.passwordForm || {}),
  };
  context.passwordErrors = extras.passwordErrors || {};
  context.passwordFlash = extras.passwordFlash || null;

  let requestedSection = extras.activeSection || context.activeSection || 'profile';
  if (requestedSection === 'watchlist' && !hasWatchlist) {
    requestedSection = 'profile';
  }
  if (requestedSection === 'bidding' && !isBidder && !isSeller) {
    requestedSection = 'profile';
  }
  if (requestedSection === 'admin' && !isAdmin) {
    requestedSection = 'profile';
  }
  context.activeSection = requestedSection;

  return context;
}

module.exports = {
  resolveRoles,
  buildAccountContext,
};
