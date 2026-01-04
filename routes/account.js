const express = require('express');

const dataService = require('../services/dataService');
const userStore = require('../services/userStore');
const { resolveRoles } = require('./account/accountMiddleware');
const { renderAccountPage } = require('./account/renderAccountPage');
const profileRoutes = require('./account/profile');
const watchlistRoutes = require('./account/watchlist');
const sellerRoutes = require('./account/seller');

const router = express.Router();

function ensureAuthenticated(req, res, next) {
  if (!req.currentUser) {
    const loginUrl = `/auth/login?returnUrl=${encodeURIComponent(req.originalUrl || '/account')}`;
    return res.redirect(loginUrl);
  }
  next();
}

router.use(ensureAuthenticated);
router.use(profileRoutes);
router.use(watchlistRoutes);
router.use('/products', sellerRoutes);

router.get('/', (req, res) => {
  res.redirect('/account/profile');
});

router.get('/seller', (req, res) => {
  res.redirect('/account/products');
});

router.get('/admin/dashboard', (req, res) => {
  res.redirect('/account/admin');
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

    // Helper to calculate effective status based on endDate
    const getEffectiveStatus = (product) => {
      const status = product.status;
      if (status === 'active' && product.endDate) {
        const endTime = new Date(product.endDate).getTime();
        if (endTime <= Date.now()) {
          return 'ended';
        }
      }
      return status;
    };

    if (role === 'seller') {
      // Seller can both sell AND bid, so fetch both
      const [sellerProducts, bidderProducts] = await Promise.all([
        dataService.getProductsBySeller(user.id),
        dataService.getProductsByBidder(user.id),
      ]);

      return res.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        // Products seller is selling
        products: sellerProducts.map((product) => ({
          id: product.id,
          title: product.title,
          status: getEffectiveStatus(product),
          startPrice: product.startPrice,
          currentPrice: product.currentPrice,
          bidCount: product.bidCount,
          endDate: product.endDate,
          watchers: product.watchers,
        })),
        // Products seller has bid on
        biddingProducts: bidderProducts.map((product) => ({
          id: product.id,
          title: product.title,
          status: getEffectiveStatus(product),
          startPrice: product.startPrice,
          currentPrice: product.currentPrice,
          myBid: product.myBid,
          isWinning: product.isWinning,
          bidCount: product.bidCount,
          endDate: product.endDate,
        })),
      });
    }

    if (role === 'bidder') {
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
          status: getEffectiveStatus(product),
          startPrice: product.startPrice,
          currentPrice: product.currentPrice,
          myBid: product.myBid,
          isWinning: product.isWinning,
          bidCount: product.bidCount,
          endDate: product.endDate,
          watchers: product.watchers,
        })),
      });
    }

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

// Admin reset user password
router.post('/admin/users/:userId/reset-password', async (req, res, next) => {
  try {
    if (!req.currentUser || !resolveRoles(req.currentUser).includes('admin')) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập.' });
    }

    const targetId = Number(req.params.userId);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Mã người dùng không hợp lệ.' });
    }

    if (req.currentUser.id === targetId) {
      return res.status(400).json({ error: 'Bạn không thể reset mật khẩu của chính mình theo cách này.' });
    }

    const user = await dataService.getUserById(targetId);
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
    }

    // Generate random password (12 characters)
    const crypto = require('crypto');
    const newPassword = crypto.randomBytes(6).toString('base64').replace(/[+/=]/g, '').substring(0, 12);
    
    // Hash password
    const bcrypt = require('bcrypt');
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password in database
    const updated = await dataService.updateUserPassword(targetId, passwordHash);
    if (!updated) {
      return res.status(500).json({ error: 'Không thể cập nhật mật khẩu.' });
    }

    // Send email notification
    const mailer = require('../services/mailer');
    const emailResult = await mailer.sendPasswordResetEmail({
      to: user.email,
      userName: user.name,
      newPassword: newPassword,
    });

    return res.json({
      success: true,
      emailSent: emailResult.success,
      message: emailResult.success 
        ? 'Mật khẩu đã được đặt lại và gửi email thông báo cho người dùng.'
        : 'Mật khẩu đã được đặt lại nhưng không thể gửi email (SMTP chưa cấu hình).',
    });
  } catch (error) {
    next(error);
  }
});

// ========== Upgrade Request Routes ==========

// Bidder submits upgrade request
router.post('/upgrade-request', async (req, res, next) => {
  try {
    if (!req.currentUser) {
      return res.status(401).json({ error: 'Bạn cần đăng nhập.' });
    }

    const roles = resolveRoles(req.currentUser);
    if (!roles.includes('bidder') || roles.includes('seller') || roles.includes('admin')) {
      return res.status(400).json({ error: 'Chỉ tài khoản bidder mới có thể yêu cầu nâng cấp.' });
    }

    const result = await dataService.createUpgradeRequest(req.currentUser.id);

    return res.json({
      success: true,
      request: result,
      message: 'Yêu cầu nâng cấp đã được gửi thành công. Vui lòng chờ admin phê duyệt.',
    });
  } catch (error) {
    if (error.message) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// Get current user's upgrade request status
router.get('/upgrade-request/status', async (req, res, next) => {
  try {
    if (!req.currentUser) {
      return res.status(401).json({ error: 'Bạn cần đăng nhập.' });
    }

    const request = await dataService.getUpgradeRequestByUser(req.currentUser.id);

    return res.json({
      success: true,
      request,
    });
  } catch (error) {
    next(error);
  }
});

// Mark upgrade notification as seen
router.post('/upgrade-notification/seen', async (req, res, next) => {
  try {
    if (!req.currentUser) {
      return res.status(401).json({ error: 'Bạn cần đăng nhập.' });
    }

    await dataService.markUpgradeNotificationSeen(req.currentUser.id);

    return res.json({
      success: true,
    });
  } catch (error) {
    next(error);
  }
});

// Admin: Get all pending upgrade requests
router.get('/admin/upgrade-requests', async (req, res, next) => {
  try {
    if (!req.currentUser || !resolveRoles(req.currentUser).includes('admin')) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập.' });
    }

    const status = req.query.status || 'pending';
    const requests = await dataService.getAllUpgradeRequests({ status });
    const counts = await dataService.getUpgradeRequestCounts();

    return res.json({
      success: true,
      requests,
      counts,
    });
  } catch (error) {
    next(error);
  }
});

// Admin: Approve upgrade request
router.post('/admin/upgrade-requests/:requestId/approve', async (req, res, next) => {
  try {
    if (!req.currentUser || !resolveRoles(req.currentUser).includes('admin')) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập.' });
    }

    const requestId = Number(req.params.requestId);
    if (!Number.isFinite(requestId) || requestId <= 0) {
      return res.status(400).json({ error: 'Mã yêu cầu không hợp lệ.' });
    }

    const adminNote = req.body.adminNote || '';
    const result = await dataService.approveUpgradeRequest(requestId, adminNote);

    return res.json({
      success: true,
      request: result,
      message: 'Đã phê duyệt yêu cầu nâng cấp.',
    });
  } catch (error) {
    if (error.message) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// Admin: Reject upgrade request
router.post('/admin/upgrade-requests/:requestId/reject', async (req, res, next) => {
  try {
    if (!req.currentUser || !resolveRoles(req.currentUser).includes('admin')) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập.' });
    }

    const requestId = Number(req.params.requestId);
    if (!Number.isFinite(requestId) || requestId <= 0) {
      return res.status(400).json({ error: 'Mã yêu cầu không hợp lệ.' });
    }

    const adminNote = req.body.adminNote || '';
    const result = await dataService.rejectUpgradeRequest(requestId, adminNote);

    return res.json({
      success: true,
      request: result,
      message: 'Đã từ chối yêu cầu nâng cấp.',
    });
  } catch (error) {
    if (error.message) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// =====================
// CATEGORY MANAGEMENT
// =====================

// Admin: Get all categories for management
router.get('/admin/categories', async (req, res, next) => {
  try {
    if (!req.currentUser || !resolveRoles(req.currentUser).includes('admin')) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập.' });
    }

    const categories = await dataService.getCategoriesForAdmin();
    const parentCategories = await dataService.getParentCategories();

    return res.json({
      success: true,
      categories,
      parentCategories,
    });
  } catch (error) {
    next(error);
  }
});

// Admin: Create a new category
router.post('/admin/categories', async (req, res, next) => {
  try {
    if (!req.currentUser || !resolveRoles(req.currentUser).includes('admin')) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập.' });
    }

    const { name, parentId, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Tên danh mục không được để trống.' });
    }

    const category = await dataService.createCategory({
      name: name.trim(),
      parentId: parentId || null,
      description: description || '',
    });

    return res.json({
      success: true,
      category,
      message: 'Đã tạo danh mục mới.',
    });
  } catch (error) {
    if (error.message) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// Admin: Update a category
router.put('/admin/categories/:categoryId', async (req, res, next) => {
  try {
    if (!req.currentUser || !resolveRoles(req.currentUser).includes('admin')) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập.' });
    }

    const categoryId = Number(req.params.categoryId);
    if (!Number.isFinite(categoryId) || categoryId <= 0) {
      return res.status(400).json({ error: 'Mã danh mục không hợp lệ.' });
    }

    const { name, parentId, description } = req.body;

    const category = await dataService.updateCategory(categoryId, {
      name,
      parentId,
      description,
    });

    return res.json({
      success: true,
      category,
      message: 'Đã cập nhật danh mục.',
    });
  } catch (error) {
    if (error.message) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// Admin: Delete a category
router.delete('/admin/categories/:categoryId', async (req, res, next) => {
  try {
    if (!req.currentUser || !resolveRoles(req.currentUser).includes('admin')) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập.' });
    }

    const categoryId = Number(req.params.categoryId);
    if (!Number.isFinite(categoryId) || categoryId <= 0) {
      return res.status(400).json({ error: 'Mã danh mục không hợp lệ.' });
    }

    const result = await dataService.deleteCategory(categoryId);

    return res.json({
      success: true,
      ...result,
      message: `Đã xóa danh mục "${result.deletedName}".`,
    });
  } catch (error) {
    if (error.message) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

module.exports = router;
