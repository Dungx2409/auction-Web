const express = require('express');
const bcrypt = require('bcryptjs');
const dayjs = require('dayjs');
const dataService = require('../services/dataService');
const userStore = require('../services/userStore');

const router = express.Router();

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

    context.bidder = {
      watchlist: watchlistItems,
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

function validateProductInput(body = {}) {
  const errors = {};
  const formValues = {
    title: sanitizeProductText(body.title),
    shortDescription: sanitizeProductText(body.shortDescription || body.summary || ''),
    fullDescription: (body.fullDescription || '').trim(),
    categoryId: body.categoryId ? String(body.categoryId) : '',
    startPrice: body.startPrice ?? '',
    stepPrice: body.stepPrice ?? '',
    buyNowPrice: body.buyNowPrice ?? '',
    startDate: body.startDate || '',
    endDate: body.endDate || '',
    imageUrl: sanitizeProductText(body.imageUrl || ''),
    autoExtend: body.autoExtend === 'on' || body.autoExtend === 'true' || body.autoExtend === true,
  };

  if (!formValues.title) {
    errors.title = 'Vui lòng nhập tên sản phẩm.';
  }

  if (!formValues.shortDescription && formValues.fullDescription) {
    formValues.shortDescription = sanitizeProductText(formValues.fullDescription.replace(/<[^>]*>/g, '').slice(0, 180));
  }

  if (!formValues.shortDescription) {
    errors.shortDescription = 'Hãy mô tả ngắn gọn sản phẩm của bạn.';
  }

  if (!formValues.fullDescription) {
    errors.fullDescription = 'Vui lòng nhập mô tả chi tiết sản phẩm.';
  }

  const categoryId = Number(formValues.categoryId);
  if (!categoryId) {
    errors.categoryId = 'Vui lòng chọn danh mục.';
  }

  const startPrice = Number(formValues.startPrice);
  if (!Number.isFinite(startPrice) || startPrice <= 0) {
    errors.startPrice = 'Giá khởi điểm phải lớn hơn 0.';
  }

  const stepPrice = Number(formValues.stepPrice);
  if (!Number.isFinite(stepPrice) || stepPrice <= 0) {
    errors.stepPrice = 'Bước giá phải lớn hơn 0.';
  }

  let buyNowPrice = null;
  if (formValues.buyNowPrice !== '') {
    const parsed = Number(formValues.buyNowPrice);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      errors.buyNowPrice = 'Giá mua ngay phải lớn hơn 0.';
    } else if (Number.isFinite(startPrice) && parsed <= startPrice) {
      errors.buyNowPrice = 'Giá mua ngay phải cao hơn giá khởi điểm.';
    } else {
      buyNowPrice = parsed;
    }
  }

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
    }
  }

  if (formValues.imageUrl && !isValidUrl(formValues.imageUrl)) {
    errors.imageUrl = 'Đường dẫn ảnh không hợp lệ.';
  }

  const values = {
    title: formValues.title,
    shortDescription: formValues.shortDescription,
    fullDescription: formValues.fullDescription,
    categoryId,
    startPrice,
    stepPrice,
    buyNowPrice,
    startDate: startDate ? startDate.toDate() : null,
    endDate: endDate ? endDate.toDate() : null,
    autoExtend: formValues.autoExtend,
    imageUrl: formValues.imageUrl || null,
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
    if (Object.keys(errors).length > 0) {
      const context = await buildAccountContext(user, {
        seller: {
          productForm: formValues,
          productErrors: errors,
        },
        activeSection: 'products',
      });
      return res.status(400).render('account/overview', context);
    }

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
    });

    const context = await buildAccountContext(user, {
      seller: {
        productFlash: {
          type: 'success',
          message: 'Đăng sản phẩm thành công! Sản phẩm của bạn đã sẵn sàng hiển thị.',
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

module.exports = router;
