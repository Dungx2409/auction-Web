const express = require('express');
const bcrypt = require('bcryptjs');
const dayjs = require('dayjs');
const dataService = require('../services/dataService');
const userStore = require('../services/userStore');
const { buildWatchSet, applyWatchStateToList, applyWatchStateToProduct } = require('../helpers/watchlist');

const router = express.Router();

const MIN_TITLE_LENGTH = 8;
const MAX_TITLE_LENGTH = 120;
const MIN_SHORT_DESCRIPTION_LENGTH = 30;
const MAX_SHORT_DESCRIPTION_LENGTH = 240;
const MIN_FULL_DESCRIPTION_LENGTH = 80;
const MIN_AUCTION_DURATION_MINUTES = 60;
const MAX_AUCTION_DURATION_DAYS = 30;
const MIN_PRICE_VALUE = 1000;

function ensureAuthenticated(req, res, next) {
  if (!req.currentUser) {
    const loginUrl = `/auth/login?returnUrl=${encodeURIComponent(req.originalUrl || '/account')}`;
    return res.redirect(loginUrl);
  }
  next();
}

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
      name: `${depth > 0 ? `${'— '.repeat(depth)} ` : ''}${node.name}`,
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

async function buildAccountContext(user, extras = {}) {
  const roles = resolveRoles(user);
  const isBidder = roles.includes('bidder');
  const isSeller = roles.includes('seller');
  const isAdmin = roles.includes('admin');
  const watchSet = buildWatchSet(user?.watchlistIds);

  const context = {
    title: 'Tài khoản của tôi',
    user,
    roles,
    isBidder,
    isSeller,
    isAdmin,
  };

  if (isBidder && user) {
    const [watchlistItems, activeBids, wins, recommendedSource] = await Promise.all([
      dataService.getWatchlistForUser(user.id),
      Promise.all((user.activeBids || []).map((productId) => dataService.getProductById(productId))).then((items) =>
        items.filter(Boolean)
      ),
      Promise.all((user.wins || []).map((productId) => dataService.getProductById(productId))).then((items) =>
        items.filter(Boolean)
      ),
      dataService.getProductsEndingSoon(8),
    ]);

    const recommended = recommendedSource.filter((product) => !wins.some((win) => win.id === product.id));
    const enrichedWatchlist = watchlistItems.map((entry) => ({
      ...entry,
      product: applyWatchStateToProduct(entry.product, watchSet),
    }));
    applyWatchStateToList(activeBids, watchSet);
    applyWatchStateToList(wins, watchSet);
    applyWatchStateToList(recommended, watchSet);

    context.bidder = {
      watchlist: enrichedWatchlist,
      activeBids,
      wins,
      recommended,
    };
  }

  if (isSeller && user) {
    const [activeProducts, endedProducts, draftProducts, settings, categories] = await Promise.all([
      dataService.getProductsBySeller(user.id, { status: 'active' }),
      dataService.getProductsBySeller(user.id, { status: ['ended'] }),
      dataService.getProductsBySeller(user.id, { status: ['draft'] }),
      dataService.getSettings(),
      dataService.getCategories(),
    ]);

    const flattenedCategories = flattenCategories(categories);
    const defaultForm = buildSellerProductFormDefaults(flattenedCategories);
    const sellerExtras = extras.seller || {};
    const providedForm = sellerExtras.productForm || {};
    applyWatchStateToList(activeProducts, watchSet);
    applyWatchStateToList(endedProducts, watchSet);
    applyWatchStateToList(draftProducts, watchSet);

    context.seller = {
      activeProducts,
      endedProducts,
      draftProducts,
      autoExtendSettings: settings.autoExtend,
      categories: flattenedCategories,
      stats: {
        active: activeProducts.length,
        ended: endedProducts.length,
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
  } else if (extras.seller) {
    context.seller = {
      ...(extras.seller || {}),
    };
  }

  if (isAdmin) {
    const [products, categories, users] = await Promise.all([
      dataService.getProducts(),
      dataService.getCategories(),
      dataService.getUsers(),
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

    context.admin = {
      stats: {
        totalProducts: products.length,
        totalCategories: categories.reduce(
          (sum, category) => sum + (category.children?.length || 0),
          0
        ),
        totalUsers: users.length,
      },
      categories,
      users,
      recentProducts: products.slice(0, 8),
      userCounts: roleCounts,
    };
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
  if (requestedSection === 'watchlist' && !isBidder) {
    requestedSection = 'profile';
  }
  if (requestedSection === 'admin' && !isAdmin) {
    requestedSection = 'profile';
  }
  context.activeSection = requestedSection;

  return context;
}

router.use(ensureAuthenticated);

router.get('/', (req, res) => {
  res.redirect('/account/profile');
});

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

router.get('/profile', (req, res, next) => {
  renderAccountPage(req, res, next, { section: 'profile' });
});

router.get('/security', (req, res, next) => {
  renderAccountPage(req, res, next, { section: 'security' });
});

router.get('/watchlist', (req, res, next) => {
  renderAccountPage(req, res, next, { section: 'watchlist' });
});

router.get('/products', (req, res, next) => {
  renderAccountPage(req, res, next, { section: 'products' });
});

router.get('/admin', (req, res, next) => {
  const isAdmin = req.currentUser && resolveRoles(req.currentUser).includes('admin');
  renderAccountPage(req, res, next, {
    section: 'admin',
    statusCode: isAdmin ? 200 : 403,
  });
});

router.get('/admin/users/:userId/products', async (req, res, next) => {
  try {
    if (!req.currentUser || !resolveRoles(req.currentUser).includes('admin')) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập.' });
    }

    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Mã người dùng không hợp lệ.' });
    }

    const user = await dataService.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
    }

    const role = String(user.role || '').toLowerCase();

    if (role === 'seller') {
      const products = await dataService.getProductsBySeller(user.id);
      return res.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        products: products.map((product) => ({
          id: product.id,
          title: product.title,
          status: product.status,
          startPrice: product.startPrice,
          currentPrice: product.currentPrice,
          bidCount: product.bidCount,
          endDate: product.endDate,
          watchers: product.watchers,
        })),
      });
    }

    if (role === 'bidder') {
      // Return products the bidder has placed bids on
      const products = await dataService.getProductsByBidder(user.id);
      return res.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        products: products.map((product) => ({
          id: product.id,
          title: product.title,
          status: product.status,
          startPrice: product.startPrice,
          currentPrice: product.currentPrice,
          bidCount: product.bidCount,
          endDate: product.endDate,
          watchers: product.watchers,
        })),
      });
    }

    // other roles: return empty product list
    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      products: [],
    });
  } catch (error) {
    next(error);
  }
});

router.post('/admin/products/:productId/remove', async (req, res, next) => {
  try {
    if (!req.currentUser || !resolveRoles(req.currentUser).includes('admin')) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập.' });
    }

    const productId = Number(req.params.productId);
    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Mã sản phẩm không hợp lệ.' });
    }

  const product = await dataService.getProductById(productId, { includeBannedSeller: true });
    if (!product) {
      return res.status(404).json({ error: 'Không tìm thấy sản phẩm.' });
    }

    if (String(product.status || '').toLowerCase() === 'removed') {
      return res.json({
        success: true,
        product: {
          id: product.id,
          status: product.status,
        },
      });
    }

    const updated = await dataService.removeProduct(productId);
    if (!updated) {
      return res.status(500).json({ error: 'Không thể xóa sản phẩm lúc này.' });
    }

    return res.json({
      success: true,
      product: {
        id: product.id,
        status: 'removed',
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/admin/products/:productId/restore', async (req, res, next) => {
  try {
    if (!req.currentUser || !resolveRoles(req.currentUser).includes('admin')) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập.' });
    }

    const productId = Number(req.params.productId);
    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Mã sản phẩm không hợp lệ.' });
    }

  const product = await dataService.getProductById(productId, { includeBannedSeller: true });
    if (!product) {
      return res.status(404).json({ error: 'Không tìm thấy sản phẩm.' });
    }

    if (String(product.status || '').toLowerCase() !== 'removed') {
      return res.json({
        success: true,
        product: {
          id: product.id,
          status: product.status,
        },
      });
    }

    const restored = await dataService.restoreProduct(productId, 'active');
    if (!restored) {
      return res.status(500).json({ error: 'Không thể khôi phục sản phẩm lúc này.' });
    }

  const refreshed = await dataService.getProductById(productId, { includeBannedSeller: true });

    return res.json({
      success: true,
      product: {
        id: refreshed?.id ?? product.id,
        status: refreshed?.status ?? 'active',
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/admin/users/:userId/ban', async (req, res, next) => {
  try {
    if (!req.currentUser || !resolveRoles(req.currentUser).includes('admin')) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập.' });
    }

    const targetId = Number(req.params.userId);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Mã người dùng không hợp lệ.' });
    }

    if (req.currentUser.id === targetId) {
      return res.status(400).json({ error: 'Bạn không thể tự khóa tài khoản của mình.' });
    }

    const user = await dataService.getUserById(targetId);
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
    }

    if (String(user.role || '').toLowerCase() === 'admin') {
      return res.status(400).json({ error: 'Không thể khóa tài khoản quản trị viên khác.' });
    }

    if (String(user.status || '').toLowerCase() === 'banned') {
      return res.json({
        success: true,
        user: {
          id: user.id,
          status: user.status,
        },
      });
    }

    const updated = await userStore.updateUser(targetId, { status: 'banned' });

    return res.json({
      success: true,
      user: {
        id: updated?.id ?? user.id,
        status: updated?.status ?? 'banned',
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/admin/users/:userId/unban', async (req, res, next) => {
  try {
    if (!req.currentUser || !resolveRoles(req.currentUser).includes('admin')) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập.' });
    }

    const targetId = Number(req.params.userId);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Mã người dùng không hợp lệ.' });
    }

    if (req.currentUser.id === targetId) {
      return res.status(400).json({ error: 'Bạn không thể tự mở khóa theo cách này.' });
    }

    const user = await dataService.getUserById(targetId);
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
    }

    const updated = await userStore.updateUser(targetId, { status: 'active' });

    return res.json({
      success: true,
      user: {
        id: updated?.id ?? user.id,
        status: updated?.status ?? 'active',
      },
    });
  } catch (error) {
    next(error);
  }
});

function validateProfileInput({ name = '', address = '' }) {
  const errors = {};
  const trimmedName = name.trim();
  const trimmedAddress = address.trim();

  if (!trimmedName) {
    errors.name = 'Vui lòng nhập họ tên.';
  }
  if (!trimmedAddress) {
    errors.address = 'Vui lòng nhập địa chỉ.';
  }

  return { errors, values: { name: trimmedName, address: trimmedAddress } };
}

function validatePasswordInput({ currentPassword = '', newPassword = '', confirmPassword = '' }) {
  const errors = {};

  if (!currentPassword.trim()) {
    errors.currentPassword = 'Vui lòng nhập mật khẩu hiện tại.';
  }
  if (!newPassword.trim()) {
    errors.newPassword = 'Vui lòng nhập mật khẩu mới.';
  } else if (newPassword.length < 6) {
    errors.newPassword = 'Mật khẩu mới cần ít nhất 6 ký tự.';
  }
  if (!confirmPassword.trim()) {
    errors.confirmPassword = 'Vui lòng xác nhận mật khẩu mới.';
  } else if (newPassword !== confirmPassword) {
    errors.confirmPassword = 'Mật khẩu xác nhận không khớp.';
  }

  return { errors, values: { currentPassword, newPassword, confirmPassword } };
}

function isValidUrl(value) {
  if (!value) return true;
  try {
    new URL(value);
    return true;
  } catch (error) {
    return false;
  }
}

function sanitizeProductText(value = '') {
  return value.trim();
}

function stripHtml(value = '') {
  return value.replace(/<[^>]*>/g, ' ');
}

function normalizeWhitespace(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

function parseGalleryUrls(value = '') {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines;
}

function validateProductInput(body = {}) {
  const errors = {};
  const rawProductId = body.productId ? Number(body.productId) : null;
  const productId = Number.isFinite(rawProductId) && rawProductId > 0 ? rawProductId : null;
  const isEditing = Boolean(productId);
  const formValues = {
    title: sanitizeProductText(body.title),
    shortDescription: sanitizeProductText(body.shortDescription || body.summary || ''),
    fullDescription: sanitizeProductText(body.fullDescription || ''),
    categoryId: body.categoryId ? String(body.categoryId) : '',
    startPrice: body.startPrice ?? '',
    stepPrice: body.stepPrice ?? '',
    currentPrice: body.startPrice ?? '',
    buyNowPrice: body.buyNowPrice ?? '',
    startDate: body.startDate || '',
    endDate: body.endDate || '',
    imageUrl: sanitizeProductText(body.imageUrl || ''),
    galleryUrls: body.galleryUrls || '',
    imageFile: body.imageFile || null,
    autoExtend: body.autoExtend === 'on' || body.autoExtend === 'true' || body.autoExtend === true,
    productId: productId ? String(productId) : '',
  };

  if (!formValues.title) {
    errors.title = 'Vui lòng nhập tên sản phẩm.';
  } else if (formValues.title.length < MIN_TITLE_LENGTH || formValues.title.length > MAX_TITLE_LENGTH) {
    errors.title = `Tên sản phẩm phải từ ${MIN_TITLE_LENGTH} đến ${MAX_TITLE_LENGTH} ký tự.`;
  }

  if (!formValues.shortDescription && formValues.fullDescription) {
    formValues.shortDescription = sanitizeProductText(formValues.fullDescription.replace(/<[^>]*>/g, '').slice(0, 180));
  }

  if (!formValues.shortDescription) {
    errors.shortDescription = 'Hãy mô tả ngắn gọn sản phẩm của bạn.';
  } else if (
    formValues.shortDescription.length < MIN_SHORT_DESCRIPTION_LENGTH ||
    formValues.shortDescription.length > MAX_SHORT_DESCRIPTION_LENGTH
  ) {
    errors.shortDescription = `Mô tả ngắn cần từ ${MIN_SHORT_DESCRIPTION_LENGTH} đến ${MAX_SHORT_DESCRIPTION_LENGTH} ký tự.`;
  }

  const plainFullDescription = normalizeWhitespace(stripHtml(formValues.fullDescription));
  if (!plainFullDescription) {
    errors.fullDescription = 'Vui lòng nhập mô tả chi tiết sản phẩm.';
  } else if (plainFullDescription.length < MIN_FULL_DESCRIPTION_LENGTH) {
    errors.fullDescription = `Mô tả chi tiết cần tối thiểu ${MIN_FULL_DESCRIPTION_LENGTH} ký tự.`;
  }

  const categoryId = Number(formValues.categoryId);
  if (!categoryId) {
    errors.categoryId = 'Vui lòng chọn danh mục.';
  }

  const startPrice = Number(formValues.startPrice);
  if (!Number.isFinite(startPrice) || startPrice <= 0) {
    errors.startPrice = 'Giá khởi điểm phải lớn hơn 0.';
  } else if (startPrice < MIN_PRICE_VALUE) {
    errors.startPrice = `Giá khởi điểm tối thiểu là ${MIN_PRICE_VALUE.toLocaleString('vi-VN')} đ.`;
  }

  const stepPrice = Number(formValues.stepPrice);
  if (!Number.isFinite(stepPrice) || stepPrice <= 0) {
    errors.stepPrice = 'Bước giá phải lớn hơn 0.';
  } else if (stepPrice < MIN_PRICE_VALUE) {
    errors.stepPrice = `Bước giá tối thiểu là ${MIN_PRICE_VALUE.toLocaleString('vi-VN')} đ.`;
  } else if (Number.isFinite(startPrice) && stepPrice >= startPrice) {
    errors.stepPrice = 'Bước giá phải nhỏ hơn giá khởi điểm.';
  }

  let buyNowPrice = null;
  if (formValues.buyNowPrice !== '') {
    const parsed = Number(formValues.buyNowPrice);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      errors.buyNowPrice = 'Giá mua ngay phải lớn hơn 0.';
    } else if (Number.isFinite(startPrice) && parsed <= startPrice) {
      errors.buyNowPrice = 'Giá mua ngay phải cao hơn giá khởi điểm.';
    } else if (Number.isFinite(startPrice) && Number.isFinite(stepPrice) && parsed <= startPrice + stepPrice) {
      errors.buyNowPrice = 'Giá mua ngay phải cao hơn ít nhất một bước giá so với giá khởi điểm.';
    } else {
      buyNowPrice = parsed;
    }
  }

  const now = dayjs();
  let startDate = null;
  if (!formValues.startDate) {
    errors.startDate = 'Vui lòng chọn thời gian bắt đầu.';
  } else {
    const parsed = dayjs(formValues.startDate);
    if (!parsed.isValid()) {
      errors.startDate = 'Thời gian bắt đầu không hợp lệ.';
    } else {
      startDate = parsed;
      formValues.startDate = parsed.format('YYYY-MM-DDTHH:mm');
      if (!isEditing && startDate.isBefore(now.add(15, 'minute'))) {
        errors.startDate = 'Thời gian bắt đầu phải sau thời điểm hiện tại ít nhất 15 phút.';
      }
    }
  }

  let endDate = null;
  if (!formValues.endDate) {
    errors.endDate = 'Vui lòng chọn thời gian kết thúc.';
  } else {
    const parsed = dayjs(formValues.endDate);
    if (!parsed.isValid()) {
      errors.endDate = 'Thời gian kết thúc không hợp lệ.';
    } else if (startDate && parsed.valueOf() <= startDate.valueOf()) {
      errors.endDate = 'Thời gian kết thúc phải sau thời gian bắt đầu.';
    } else {
      endDate = parsed;
      formValues.endDate = parsed.format('YYYY-MM-DDTHH:mm');
      if (startDate) {
        const durationMinutes = endDate.diff(startDate, 'minute');
        if (durationMinutes < MIN_AUCTION_DURATION_MINUTES) {
          errors.endDate = `Phiên đấu giá cần kéo dài ít nhất ${MIN_AUCTION_DURATION_MINUTES / 60} giờ.`;
        }
        const durationDays = endDate.diff(startDate, 'day', true);
        if (!errors.endDate && durationDays > MAX_AUCTION_DURATION_DAYS) {
          errors.endDate = `Phiên đấu giá không được vượt quá ${MAX_AUCTION_DURATION_DAYS} ngày.`;
        }
      }
    }
  }
  if (!formValues.imageUrl) {
    errors.imageUrl = 'Vui lòng nhập đường dẫn ảnh chính của sản phẩm.';
  } else if (!isValidUrl(formValues.imageUrl)) {
    errors.imageUrl = 'Đường dẫn ảnh không hợp lệ.';
  }

  const parsedGalleryUrls = parseGalleryUrls(formValues.galleryUrls);

  if (parsedGalleryUrls.length > 0) {
    for (const url of parsedGalleryUrls) {
      if (!isValidUrl(url)) {
        errors.galleryUrls = 'Một hoặc nhiều đường dẫn ảnh bổ sung không hợp lệ.';
        break;
      }
    }
  }
  if (!errors.galleryUrls && parsedGalleryUrls.length < 3) {
    errors.galleryUrls = 'Vui lòng cung cấp ít nhất 3 ảnh bổ sung cho sản phẩm.';
  }

  const values = {
    productId,
    title: formValues.title,
    shortDescription: formValues.shortDescription,
    fullDescription: formValues.fullDescription,
    categoryId,
    startPrice,
    currentPrice: formValues.currentPrice ?? '',
    stepPrice,
    buyNowPrice,
    startDate: startDate ? startDate.toDate() : null,
    endDate: endDate ? endDate.toDate() : null,
    autoExtend: formValues.autoExtend,
    imageUrl: formValues.imageUrl || null,
    galleryUrls: parsedGalleryUrls,
    imageFile: formValues.imageFile || null,
  };

  return { errors, values, formValues };
}

router.post('/profile', async (req, res, next) => {
  try {
    const { name = '', address = '' } = req.body || {};
    const userId = req.currentUser?.id;
    if (!userId) {
      return res.redirect('/auth/login');
    }

    const { errors, values } = validateProfileInput({ name, address });
    if (Object.keys(errors).length > 0) {
      const context = await buildAccountContext(req.currentUser, {
        profileForm: {
          name,
          address,
          email: req.currentUser?.email,
        },
        profileErrors: errors,
        activeSection: 'profile',
      });
      return res.status(400).render('account/overview', context);
    }

    const updatedUser = await userStore.updateUser(userId, {
      name: values.name,
      address: values.address,
    });

    const nextUser = updatedUser || { ...req.currentUser, ...values };
    req.currentUser = nextUser;
    res.locals.currentUser = nextUser;
    const context = await buildAccountContext(nextUser, {
      profileFlash: {
        type: 'success',
        message: 'Cập nhật thông tin cá nhân thành công.',
      },
      activeSection: 'profile',
    });
    res.render('account/overview', context);
  } catch (error) {
    next(error);
  }
});

router.post('/password', async (req, res, next) => {
  try {
    const { currentPassword = '', newPassword = '', confirmPassword = '' } = req.body || {};
    const user = req.currentUser;
    if (!user?.id) {
      return res.redirect('/auth/login');
    }

    const { errors, values } = validatePasswordInput({ currentPassword, newPassword, confirmPassword });
    if (Object.keys(errors).length > 0) {
      const context = await buildAccountContext(user, {
        passwordForm: values,
        passwordErrors: errors,
        activeSection: 'security',
      });
      return res.status(400).render('account/overview', context);
    }

    const hasPasswordHash = Boolean(user.passwordHash);
    if (hasPasswordHash) {
      const match = await bcrypt.compare(values.currentPassword, user.passwordHash);
      if (!match) {
        const context = await buildAccountContext(user, {
          passwordForm: values,
          passwordErrors: { currentPassword: 'Mật khẩu hiện tại không chính xác.' },
          activeSection: 'security',
        });
        return res.status(400).render('account/overview', context);
      }
    } else if (values.currentPassword !== '123456') {
      const context = await buildAccountContext(user, {
        passwordForm: values,
        passwordErrors: { currentPassword: 'Mật khẩu hiện tại không chính xác.' },
        activeSection: 'security',
      });
      return res.status(400).render('account/overview', context);
    }

    const passwordHash = await bcrypt.hash(values.newPassword, 10);
    const updatedUser = await userStore.updateUser(user.id, { passwordHash });

    const nextUser = updatedUser || { ...user, passwordHash };
    req.currentUser = nextUser;
    res.locals.currentUser = nextUser;
    const context = await buildAccountContext(nextUser, {
      passwordFlash: {
        type: 'success',
        message: 'Đổi mật khẩu thành công.',
      },
      activeSection: 'security',
    });
    res.render('account/overview', context);
  } catch (error) {
    next(error);
  }
});

router.post('/products', async (req, res, next) => {
  try {
    const user = req.currentUser;
    if (!user?.id) {
      return res.redirect('/auth/login');
    }

    const roles = resolveRoles(user);
    if (!roles.includes('seller')) {
      const context = await buildAccountContext(user, {
        seller: {
          productFlash: {
            type: 'error',
            message: 'Chỉ người bán mới được phép đăng sản phẩm.',
          },
        },
        activeSection: 'products',
      });
      return res.status(403).render('account/overview', context);
    }
    const { errors, values, formValues } = validateProductInput(req.body || {});
    const isEditing = Boolean(values.productId);
    console.log('Validated product values:', values);
    if (Object.keys(errors).length > 0) {
      const context = await buildAccountContext(user, {
        seller: {
          productForm: formValues,
          productErrors: errors,
          editingProductId: isEditing ? values.productId : null,
        },
        activeSection: 'products',
      });
      return res.status(400).render('account/overview', context);
    }
    // console.log('Validated product values:', values.galleryUrls);
    if (isEditing) {
      await dataService.updateProduct({
        productId: values.productId,
        sellerId: user.id,
        categoryId: values.categoryId,
        title: values.title,
        shortDescription: values.shortDescription,
        fullDescription: values.fullDescription,
        startPrice: values.startPrice,
        stepPrice: values.stepPrice,
        buyNowPrice: values.buyNowPrice,
        startDate: values.startDate,
        endDate: values.endDate,
        autoExtend: values.autoExtend,
        imageUrl: values.imageUrl,
        galleryUrls: values.galleryUrls,
      });
    } else {
      await dataService.createProduct({
        sellerId: user.id,
        categoryId: values.categoryId,
        title: values.title,
        shortDescription: values.shortDescription,
        fullDescription: values.fullDescription,
        startPrice: values.startPrice,
        stepPrice: values.stepPrice,
        buyNowPrice: values.buyNowPrice,
        startDate: values.startDate,
        endDate: values.endDate,
        autoExtend: values.autoExtend,
        imageUrl: values.imageUrl,
        galleryUrls: values.galleryUrls,
        imageFile: values.imageFile,
      });
    }

    const context = await buildAccountContext(user, {
      seller: {
        productFlash: {
          type: 'success',
          message: isEditing
            ? 'Cập nhật sản phẩm thành công! Thông tin mới đã được áp dụng.'
            : 'Đăng sản phẩm thành công! Sản phẩm của bạn đã sẵn sàng hiển thị.',
        },
      },
      activeSection: 'products',
    });
    res.render('account/overview', context);
  } catch (error) {
    next(error);
  }
});

router.get('/seller', (req, res) => {
  res.redirect('/account/products');
});

router.get('/admin/dashboard', (req, res) => {
  res.redirect('/account/admin');
});

router.get('/products/:id/delete', async (req, res, next) => {
  try {
    const productId = req.params.id;
    const user = req.currentUser;
    if (!user?.id) {
      return res.redirect('/auth/login');
    }
    if (!resolveRoles(user).includes('seller')) {
      return res.status(403).render('403', { title: 'Bạn không có quyền xóa sản phẩm.' });
    }
    const removed = await dataService.removeProduct(productId);
    if (!removed) {
      return res.status(404).render('404', { title: 'Sản phẩm không tồn tại hoặc đã được xóa.' });
    }
    return res.redirect('/account/products');
  } catch (error) {
    next(error);
  }
});

router.get('/products/:id/edit', async (req, res, next) => {
  try {
    const productId = req.params.id;
    const user = req.currentUser;
    if (!user?.id) {
      return res.redirect('/auth/login');
    }
    const product = await dataService.getProductById(productId, { includeBannedSeller: true });
    if (!product) {
      return res.status(404).render('404', { title: 'Sản phẩm không tồn tại' });
    }
    if (String(product.seller?.id) !== String(user.id)) {
      return res.status(403).render('403', { title: 'Bạn không có quyền chỉnh sửa sản phẩm này.' });
    }

    const productForm = {
      productId: product.id,
      title: product.title,
      shortDescription: product.summary,
      fullDescription: product.description,
      categoryId: product.categoryId ? String(product.categoryId) : '',
      startPrice: product.startPrice,
      stepPrice: product.bidStep,
      buyNowPrice: product.buyNowPrice ?? '',
      startDate: product.startDate ? dayjs(product.startDate).format('YYYY-MM-DDTHH:mm') : '',
      endDate: product.endDate ? dayjs(product.endDate).format('YYYY-MM-DDTHH:mm') : '',
      imageUrl: product.images?.[0] || '',
      galleryUrls: (product.images || []).slice(1).join('\n'),
      autoExtend: product.autoExtend,
    };

    return renderAccountPage(req, res, next, {
      section: 'products',
      extras: {
        seller: {
          productForm,
          editingProductId: product.id,
          editingProductTitle: product.title,
          productFlash: {
            type: 'info',
            message: 'Đang ở chế độ chỉnh sửa sản phẩm. Sau khi lưu, biểu mẫu sẽ quay về chế độ đăng mới.',
          },
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
