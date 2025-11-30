const express = require('express');
const { URLSearchParams } = require('url');

const dataService = require('../services/dataService');

const router = express.Router();

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
  async (req, res, next) => {
    try {
      const { paymentMethod, billingAddress, shippingAddress, paymentProof, note } = req.body || {};
      await dataService.submitOrderPaymentDetails({
        orderId: req.orderContext.id,
        buyerId: req.currentUser.id,
        paymentMethod,
        billingAddress,
        shippingAddress,
        paymentProof,
        note,
      });
      return redirectToFulfillment(res, req.orderContext, {
        fulfillSuccess: 'Đã gửi thông tin thanh toán, chờ người bán xác nhận.',
      });
    } catch (error) {
      console.error('[orders] payment-details error', error);
      const message = resolveOrderErrorMessage(error, 'Không thể gửi thông tin thanh toán. Vui lòng thử lại.');
      return redirectToFulfillment(res, req.orderContext, {
        fulfillError: message,
      });
    }
  }
);

router.post(
  '/:orderId/payment-confirmation',
  ensureAuthenticated,
  loadOrder,
  ensureSeller,
  async (req, res, next) => {
    try {
      const { carrier, trackingNumber, shippingDate, invoiceUrl } = req.body || {};
      await dataService.sellerConfirmPaymentAndShipment({
        orderId: req.orderContext.id,
        sellerId: req.currentUser.id,
        carrier,
        trackingNumber,
        shippingDate,
        invoiceUrl,
      });
      return redirectToFulfillment(res, req.orderContext, {
        fulfillSuccess: 'Đã xác nhận thanh toán và gửi thông tin vận chuyển.',
      });
    } catch (error) {
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
