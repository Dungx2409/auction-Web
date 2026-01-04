const express = require('express');
const { URLSearchParams } = require('url');
const path = require('path');
const fs = require('fs/promises');
const multer = require('multer');

const dataService = require('../services/dataService');

const router = express.Router();

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
const INVOICE_UPLOAD_FIELD = 'invoiceImages';
const MAX_INVOICE_FILES = 5;
const MAX_INVOICE_FILE_SIZE = 10 * 1024 * 1024; // 10MB per image

const invoiceStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const orderId = req.orderContext?.id || req.params.orderId;
      const buyerId = req.orderContext?.buyerId || req.currentUser?.id;
      if (!orderId || !buyerId) {
        return cb(new Error('INVALID_ORDER_CONTEXT'));
      }
      const targetDir = path.join(UPLOAD_ROOT, 'invoices', String(orderId), String(buyerId));
      fs.mkdir(targetDir, { recursive: true })
        .then(() => cb(null, targetDir))
        .catch((error) => cb(error));
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const index = (req.savedInvoiceIndex = (req.savedInvoiceIndex || 0) + 1);
    cb(null, `invoice_${index}${ext}`);
  },
});

const invoiceUpload = multer({
  storage: invoiceStorage,
  limits: {
    fileSize: MAX_INVOICE_FILE_SIZE,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      return cb(null, true);
    }
    const error = new Error('INVALID_INVOICE_FILE');
    error.code = 'INVALID_INVOICE_FILE';
    return cb(error);
  },
});

function buildInvoicePublicPath(absolutePath) {
  if (!absolutePath) return null;
  const projectRoot = path.join(__dirname, '..');
  const relativePath = path.relative(projectRoot, absolutePath).replace(/\\/g, '/');
  return `/${relativePath}`;
}

async function cleanupInvoiceFiles(files = []) {
  const targets = Array.isArray(files) ? files : [];
  await Promise.allSettled(
    targets.map((file) => (file?.path ? fs.unlink(file.path).catch(() => undefined) : Promise.resolve()))
  );
}

function handleInvoiceUpload(req, res, next) {
  const uploader = invoiceUpload.array(INVOICE_UPLOAD_FIELD, MAX_INVOICE_FILES);
  uploader(req, res, (err) => {
    if (!err) {
      return next();
    }
    console.error('[orders] invoice upload error', err);
    let message = 'Không thể tải hoá đơn. Vui lòng thử lại với tệp ảnh hợp lệ.';
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'Mỗi ảnh hoá đơn tối đa 10MB.';
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
      message = `Bạn chỉ được tải tối đa ${MAX_INVOICE_FILES} ảnh.`;
    } else if (err.code === 'INVALID_INVOICE_FILE') {
      message = 'Chỉ chấp nhận định dạng ảnh (JPG, PNG, JPEG...).';
    }
    return redirectToFulfillment(res, req.orderContext, {
      fulfillError: message,
      focus: 'payment',
    });
  });
}

// ========== Shipment Proof Upload Config ==========
const SHIPMENT_PROOF_FIELD = 'shipmentProofImages';
const MAX_SHIPMENT_PROOF_FILES = 5;

const shipmentProofStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const orderId = req.orderContext?.id || req.params.orderId;
      const sellerId = req.currentUser?.id;
      if (!orderId || !sellerId) {
        return cb(new Error('INVALID_ORDER_CONTEXT'));
      }
      const targetDir = path.join(UPLOAD_ROOT, 'invoices', String(orderId), `seller_${sellerId}`);
      fs.mkdir(targetDir, { recursive: true })
        .then(() => cb(null, targetDir))
        .catch((error) => cb(error));
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const index = (req.savedShipmentProofIndex = (req.savedShipmentProofIndex || 0) + 1);
    cb(null, `shipment_proof_${index}${ext}`);
  },
});

const shipmentProofUpload = multer({
  storage: shipmentProofStorage,
  limits: {
    fileSize: MAX_INVOICE_FILE_SIZE,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      return cb(null, true);
    }
    const error = new Error('INVALID_SHIPMENT_PROOF_FILE');
    error.code = 'INVALID_SHIPMENT_PROOF_FILE';
    return cb(error);
  },
});

function handleShipmentProofUpload(req, res, next) {
  const uploader = shipmentProofUpload.array(SHIPMENT_PROOF_FIELD, MAX_SHIPMENT_PROOF_FILES);
  uploader(req, res, (err) => {
    if (!err) {
      return next();
    }
    console.error('[orders] shipment proof upload error', err);
    let message = 'Không thể tải chứng từ. Vui lòng thử lại với tệp ảnh hợp lệ.';
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'Mỗi ảnh chứng từ tối đa 10MB.';
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
      message = `Bạn chỉ được tải tối đa ${MAX_SHIPMENT_PROOF_FILES} ảnh.`;
    } else if (err.code === 'INVALID_SHIPMENT_PROOF_FILE') {
      message = 'Chỉ chấp nhận định dạng ảnh (JPG, PNG, JPEG...).';
    }
    return redirectToFulfillment(res, req.orderContext, {
      fulfillError: message,
      focus: 'seller-confirm',
    });
  });
}

const ORDER_ERROR_MESSAGES = {
  ORDER_PAYMENT_DETAILS_REQUIRED: 'Vui lòng nhập phương thức thanh toán và địa chỉ giao hàng.',
  ORDER_INVALID_STATE: 'Trạng thái đơn hàng không hợp lệ cho thao tác này.',
  ORDER_FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  ORDER_NOT_FOUND: 'Đơn hàng không tồn tại hoặc đã bị xoá.',
};

function resolveOrderErrorMessage(error, fallback) {
  if (!error) return fallback;
  const key = String(error.code || error.message || '').toUpperCase();
  if (key && ORDER_ERROR_MESSAGES[key]) {
    return ORDER_ERROR_MESSAGES[key];
  }
  return fallback;
}

function ensureAuthenticated(req, res, next) {
  if (req.currentUser?.id) {
    return next();
  }
  const params = new URLSearchParams();
  params.set('returnUrl', req.originalUrl || req.url || '/');
  return res.redirect(`/auth/login?${params.toString()}`);
}

async function loadOrder(req, res, next) {
  try {
    const order = await dataService.getOrderById(req.params.orderId);
    if (!order) {
      return res.status(404).render('404', { title: 'Đơn hàng không tồn tại' });
    }
    req.orderContext = order;
    return next();
  } catch (error) {
    return next(error);
  }
}

function ensureParticipant(req, res, next) {
  const userId = req.currentUser?.id;
  const order = req.orderContext;
  if (!userId || !order) {
    return res.status(403).render('403', { title: 'Bạn không có quyền thực hiện thao tác này' });
  }
  const isParticipant = [order.buyerId, order.sellerId]
    .filter((value) => value != null)
    .some((value) => String(value) === String(userId));
  if (!isParticipant) {
    return res.status(403).render('403', { title: 'Bạn không có quyền thực hiện thao tác này' });
  }
  return next();
}

function ensureBuyer(req, res, next) {
  if (String(req.orderContext?.buyerId || '') === String(req.currentUser?.id || '')) {
    return next();
  }
  return res.status(403).render('403', { title: 'Chỉ người thắng đấu giá mới thao tác được bước này' });
}

function ensureSeller(req, res, next) {
  if (String(req.orderContext?.sellerId || '') === String(req.currentUser?.id || '')) {
    return next();
  }
  return res.status(403).render('403', { title: 'Chỉ người bán mới thao tác được bước này' });
}

function redirectToFulfillment(res, order, params = {}) {
  const searchParams = new URLSearchParams(params);
  const query = searchParams.toString();
  res.redirect(`/products/${order.productId}${query ? `?${query}` : ''}`);
}

router.post(
  '/:orderId/payment-details',
  ensureAuthenticated,
  loadOrder,
  ensureBuyer,
  handleInvoiceUpload,
  async (req, res, next) => {
    const uploadedFiles = req.files || [];
    try {
      const { paymentMethod, billingAddress, shippingAddress, note } = req.body || {};
      const proofPaths = uploadedFiles
        .map((file) => buildInvoicePublicPath(file.path))
        .filter((entry) => Boolean(entry));

      if (!proofPaths.length) {
        await cleanupInvoiceFiles(uploadedFiles);
        return redirectToFulfillment(res, req.orderContext, {
          fulfillError: 'Vui lòng tải ít nhất một ảnh hoá đơn hợp lệ.',
          focus: 'payment',
        });
      }

      await dataService.submitOrderPaymentDetails({
        orderId: req.orderContext.id,
        buyerId: req.currentUser.id,
        paymentMethod,
        billingAddress,
        shippingAddress,
        paymentProof: JSON.stringify(proofPaths),
        note,
      });
      return redirectToFulfillment(res, req.orderContext, {
        fulfillSuccess: 'Đã gửi thông tin thanh toán, chờ người bán xác nhận.',
      });
    } catch (error) {
      await cleanupInvoiceFiles(uploadedFiles);
      console.error('[orders] payment-details error', error);
      const message = resolveOrderErrorMessage(error, 'Không thể gửi thông tin thanh toán. Vui lòng thử lại.');
      return redirectToFulfillment(res, req.orderContext, {
        fulfillError: message,
        focus: 'payment',
      });
    }
  }
);

router.post(
  '/:orderId/payment-confirmation',
  ensureAuthenticated,
  loadOrder,
  ensureSeller,
  handleShipmentProofUpload,
  async (req, res, next) => {
    const uploadedFiles = req.files || [];
    try {
      const { carrier, trackingNumber, shippingDate, invoiceUrl } = req.body || {};
      
      // Build proof paths from uploaded files
      const proofPaths = uploadedFiles.map((file) => {
        const orderId = req.orderContext?.id || req.params.orderId;
        const sellerId = req.currentUser?.id;
        return `/uploads/invoices/${orderId}/seller_${sellerId}/${file.filename}`;
      });
      
      await dataService.sellerConfirmPaymentAndShipment({
        orderId: req.orderContext.id,
        sellerId: req.currentUser.id,
        carrier,
        trackingNumber,
        shippingDate,
        invoiceUrl,
        shipmentProofImages: proofPaths.length > 0 ? JSON.stringify(proofPaths) : null,
      });
      return redirectToFulfillment(res, req.orderContext, {
        fulfillSuccess: 'Đã xác nhận thanh toán và gửi thông tin vận chuyển.',
      });
    } catch (error) {
      // Cleanup uploaded files on error
      if (uploadedFiles.length > 0) {
        for (const file of uploadedFiles) {
          try {
            await fs.unlink(file.path);
          } catch (e) { /* ignore */ }
        }
      }
      console.error('[orders] payment-confirmation error', error);
      const message = resolveOrderErrorMessage(error, 'Không thể xác nhận thanh toán hoặc vận chuyển. Thử lại sau.');
      return redirectToFulfillment(res, req.orderContext, {
        fulfillError: message,
      });
    }
  }
);

router.post(
  '/:orderId/delivery-confirmation',
  ensureAuthenticated,
  loadOrder,
  ensureBuyer,
  async (req, res, next) => {
    try {
      await dataService.buyerConfirmDelivery({
        orderId: req.orderContext.id,
        buyerId: req.currentUser.id,
      });
      return redirectToFulfillment(res, req.orderContext, {
        fulfillSuccess: 'Bạn đã xác nhận nhận hàng. Hãy đánh giá giao dịch nhé!',
      });
    } catch (error) {
      console.error('[orders] delivery-confirmation error', error);
      const message = resolveOrderErrorMessage(error, 'Không thể xác nhận nhận hàng. Vui lòng thử lại.');
      return redirectToFulfillment(res, req.orderContext, {
        fulfillError: message,
      });
    }
  }
);

router.post(
  '/:orderId/cancel',
  ensureAuthenticated,
  loadOrder,
  ensureSeller,
  async (req, res, next) => {
    try {
      const { reason } = req.body || {};
      await dataService.cancelOrderBySeller({
        orderId: req.orderContext.id,
        sellerId: req.currentUser.id,
        reason,
      });
      return redirectToFulfillment(res, req.orderContext, {
        fulfillSuccess: 'Đã huỷ giao dịch. Người thắng đấu giá sẽ nhận thông báo.',
      });
    } catch (error) {
      console.error('[orders] cancel error', error);
      const message = resolveOrderErrorMessage(error, 'Không thể huỷ giao dịch ở trạng thái hiện tại.');
      return redirectToFulfillment(res, req.orderContext, {
        fulfillError: message,
      });
    }
  }
);

router.post(
  '/:orderId/feedback',
  ensureAuthenticated,
  loadOrder,
  ensureParticipant,
  async (req, res, next) => {
    try {
      const scoreInput = (req.body?.score || '').toString().trim().toLowerCase();
      const numericScore = scoreInput === 'positive' ? 1 : scoreInput === 'negative' ? -1 : Number(scoreInput);
      const comment = req.body?.comment || '';
      const order = req.orderContext;
      const isBuyer = String(order.buyerId) === String(req.currentUser.id);
      const targetUserId = isBuyer ? order.sellerId : order.buyerId;
      await dataService.upsertOrderRating({
        orderId: order.id,
        productId: order.productId,
        fromUserId: req.currentUser.id,
        toUserId: targetUserId,
        score: numericScore,
        comment,
      });
      return redirectToFulfillment(res, order, {
        fulfillSuccess: 'Đã lưu đánh giá của bạn.',
      });
    } catch (error) {
      console.error('[orders] feedback error', error);
      const message = resolveOrderErrorMessage(error, 'Không thể lưu đánh giá. Kiểm tra lại thông tin.');
      return redirectToFulfillment(res, req.orderContext, {
        fulfillError: message,
      });
    }
  }
);

router.post(
  '/:orderId/chat',
  ensureAuthenticated,
  loadOrder,
  ensureParticipant,
  async (req, res, next) => {
    try {
      await dataService.appendOrderMessage({
        orderId: req.orderContext.id,
        senderId: req.currentUser.id,
        message: req.body?.message,
      });
      return redirectToFulfillment(res, req.orderContext, {
        fulfillSuccess: 'Đã gửi tin nhắn.',
        focus: 'chat',
      });
    } catch (error) {
      console.error('[orders] chat error', error);
      const message = resolveOrderErrorMessage(error, 'Không thể gửi tin nhắn. Thử lại.');
      return redirectToFulfillment(res, req.orderContext, {
        fulfillError: message,
      });
    }
  }
);

module.exports = router;
