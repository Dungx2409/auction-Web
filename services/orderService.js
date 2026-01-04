const { getKnex, toNumber } = require('./shared/dbUtils');

const ORDER_STATUSES = Object.freeze({
	AWAITING_PAYMENT_DETAILS: 'awaiting_payment_details',
	PAYMENT_CONFIRMED_AWAITING_DELIVERY: 'payment_confirmed_awaiting_delivery',
	DELIVERY_CONFIRMED_READY_TO_RATE: 'delivery_confirmed_ready_to_rate',
	TRANSACTION_COMPLETED: 'transaction_completed',
	CANCELED_BY_SELLER: 'canceled_by_seller',
});

const ORDER_STATUS_FLOW = [
	ORDER_STATUSES.AWAITING_PAYMENT_DETAILS,
	ORDER_STATUSES.PAYMENT_CONFIRMED_AWAITING_DELIVERY,
	ORDER_STATUSES.DELIVERY_CONFIRMED_READY_TO_RATE,
	ORDER_STATUSES.TRANSACTION_COMPLETED,
];

const ORDER_STATUS_LABELS = {
	[ORDER_STATUSES.AWAITING_PAYMENT_DETAILS]: 'Chờ thông tin thanh toán',
	[ORDER_STATUSES.PAYMENT_CONFIRMED_AWAITING_DELIVERY]: 'Chờ xác nhận từ người bán',
	[ORDER_STATUSES.DELIVERY_CONFIRMED_READY_TO_RATE]: 'Đơn hàng đang được giao',
	[ORDER_STATUSES.TRANSACTION_COMPLETED]: 'Chờ đánh giá',
	[ORDER_STATUSES.CANCELED_BY_SELLER]: 'Đã huỷ bởi người bán',
};

const ORDER_CANCELABLE_STATUSES = new Set([
	ORDER_STATUSES.AWAITING_PAYMENT_DETAILS,
	ORDER_STATUSES.PAYMENT_CONFIRMED_AWAITING_DELIVERY,
	ORDER_STATUSES.DELIVERY_CONFIRMED_READY_TO_RATE,
]);

const DEFAULT_CHAT_HISTORY_LIMIT = 50;

let orderStatusEnumEnsured = false;

function translateOrderStatus(status) {
	return ORDER_STATUS_LABELS[status] || 'Không xác định';
}

async function ensureOrderStatusEnumValues() {
	if (orderStatusEnumEnsured) return;
	const db = getKnex();
	for (const status of Object.values(ORDER_STATUSES)) {
		const sql = `DO $$
BEGIN
	BEGIN
		ALTER TYPE order_status ADD VALUE '${status}';
	EXCEPTION
		WHEN duplicate_object THEN NULL;
	END;
END
$$;`;
		await db.raw(sql);
	}
	orderStatusEnumEnsured = true;
}

function baseOrderQuery(db) {
	return db('orders as o')
		.leftJoin('users as buyer', 'buyer.id', 'o.buyer_id')
		.leftJoin('users as seller', 'seller.id', 'o.seller_id')
		.select(
			'o.*',
			'buyer.full_name as buyer_name',
			'buyer.rating_pos as buyer_rating_pos',
			'buyer.rating_neg as buyer_rating_neg',
			'seller.full_name as seller_name',
			'seller.rating_pos as seller_rating_pos',
			'seller.rating_neg as seller_rating_neg'
		);
}

function mapOrderRow(row, extras = {}) {
	if (!row) return null;
	return {
		id: row.id,
		productId: row.product_id,
		sellerId: row.seller_id,
		buyerId: row.buyer_id,
		status: row.status,
		totalPrice: toNumber(row.total_price),
		cancelReason: row.cancel_reason,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		buyer:
			extras.buyer ||
			(row.buyer_id
				? {
						id: row.buyer_id,
						name: row.buyer_name || null,
						ratingPlus: Number(row.buyer_rating_pos || 0),
						ratingMinus: Number(row.buyer_rating_neg || 0),
					}
				: null),
		seller:
			extras.seller ||
			(row.seller_id
				? {
						id: row.seller_id,
						name: row.seller_name || null,
						ratingPlus: Number(row.seller_rating_pos || 0),
						ratingMinus: Number(row.seller_rating_neg || 0),
					}
				: null),
		invoice: extras.invoice || null,
		shipment: extras.shipment || null,
		chatMessages: extras.chatMessages || [],
		ratings:
			extras.ratings || {
				buyerToSeller: null,
				sellerToBuyer: null,
			},
	};
}

async function getOrderRowById(orderId, trx) {
	if (!orderId) return null;
	const executor = trx || getKnex();
	return baseOrderQuery(executor).where('o.id', orderId).first();
}

async function getOrderRowByProduct(productId, trx) {
	if (!productId) return null;
	const executor = trx || getKnex();
	return baseOrderQuery(executor).where('o.product_id', productId).first();
}

async function getOrderRatings(orderRow, trx) {
	if (!orderRow) return { buyerToSeller: null, sellerToBuyer: null };
	const executor = trx || getKnex();
	const rows = await executor('ratings')
		.where('product_id', orderRow.product_id)
		.andWhere((builder) => {
			builder.where('from_user_id', orderRow.buyer_id).orWhere('from_user_id', orderRow.seller_id);
		})
		.andWhere((builder) => {
			builder.where('to_user_id', orderRow.buyer_id).orWhere('to_user_id', orderRow.seller_id);
		});

	const result = {
		buyerToSeller: null,
		sellerToBuyer: null,
	};

	rows.forEach((rating) => {
		const payload = {
			id: rating.id,
			score: Number(rating.score),
			comment: rating.comment,
			updatedAt: rating.created_at,
			fromUserId: rating.from_user_id,
			toUserId: rating.to_user_id,
		};
		if (String(rating.from_user_id) === String(orderRow.buyer_id)) {
			result.buyerToSeller = payload;
		} else if (String(rating.from_user_id) === String(orderRow.seller_id)) {
			result.sellerToBuyer = payload;
		}
	});

	return result;
}

async function getOrderInvoice(orderId, trx) {
	if (!orderId) return null;
	const executor = trx || getKnex();
	const row = await executor('order_invoices').where({ order_id: orderId }).orderBy('created_at', 'desc').first();
	if (!row) return null;
	const normalizeProofList = (raw) => {
		if (!raw) return [];
		const trimmed = String(raw).trim();
		if (!trimmed) return [];
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) {
				return parsed
					.map((entry) => (entry == null ? null : String(entry).trim()))
					.filter((entry) => Boolean(entry));
			}
		} catch (error) {
			// fallthrough
		}
		if (/^(https?:\/\/|\/)/i.test(trimmed)) {
			return [trimmed];
		}
		return [];
	};
	return {
		id: row.id,
		billingAddress: row.billing_address,
		shippingAddress: row.shipping_address,
		paymentMethod: row.payment_method,
		paymentProof: row.payment_proof,
		paymentProofFiles: normalizeProofList(row.payment_proof),
		note: row.note,
		createdAt: row.created_at,
	};
}

async function getOrderShipment(orderId, trx) {
	if (!orderId) return null;
	const executor = trx || getKnex();
	const row = await executor('order_shipments').where({ order_id: orderId }).orderBy('created_at', 'desc').first();
	if (!row) return null;
	
	// Parse proof_images JSON array
	const normalizeProofImages = (raw) => {
		if (!raw) return [];
		const trimmed = String(raw).trim();
		if (!trimmed) return [];
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) {
				return parsed
					.map((entry) => (entry == null ? null : String(entry).trim()))
					.filter((entry) => Boolean(entry));
			}
		} catch (error) {
			// fallthrough
		}
		if (/^(https?:\/\/|\/)/i.test(trimmed)) {
			return [trimmed];
		}
		return [];
	};
	
	return {
		id: row.id,
		carrier: row.carrier,
		trackingNumber: row.tracking_number,
		invoiceUrl: row.invoice_url,
		proofImages: normalizeProofImages(row.proof_images),
		shippingDate: row.shipping_date,
		createdAt: row.created_at,
	};
}

async function listOrderMessages(orderId, { limit = DEFAULT_CHAT_HISTORY_LIMIT, trx } = {}) {
	if (!orderId) return [];
	const executor = trx || getKnex();
	const rows = await executor('order_chats as oc')
		.leftJoin('users as u', 'u.id', 'oc.sender_id')
		.where('oc.order_id', orderId)
		.orderBy('oc.created_at', 'asc')
		.limit(Math.max(limit, 10))
		.select('oc.id', 'oc.message', 'oc.created_at', 'oc.sender_id', 'u.full_name as sender_name');
	return rows.map((row) => ({
		id: row.id,
		message: row.message,
		senderId: row.sender_id,
		senderName: row.sender_name || 'Ẩn danh',
		createdAt: row.created_at,
	}));
}

async function getOrderContextByRow(row, options = {}) {
	if (!row) return null;
	const [invoice, shipment, chatMessages, ratings] = await Promise.all([
		getOrderInvoice(row.id, options.trx),
		getOrderShipment(row.id, options.trx),
		listOrderMessages(row.id, { limit: options.chatLimit ?? DEFAULT_CHAT_HISTORY_LIMIT, trx: options.trx }),
		getOrderRatings(row, options.trx),
	]);
	return mapOrderRow(row, { invoice, shipment, chatMessages, ratings });
}

async function getOrderById(orderId, options = {}) {
	const row = await getOrderRowById(orderId, options.trx);
	return getOrderContextByRow(row, options);
}

async function getOrderByProductId(productId, options = {}) {
	const row = await getOrderRowByProduct(productId, options.trx);
	return getOrderContextByRow(row, options);
}

async function ensureOrderForProduct(product, { chatLimit } = {}) {
	if (!product?.id || !product?.seller?.id) {
		return null;
	}
	const buyerId = product.highestBidder?.id;
	if (!buyerId) {
		return null;
	}
	await ensureOrderStatusEnumValues();
	const db = getKnex();
	return db.transaction(async (trx) => {
		let orderRow = await getOrderRowByProduct(product.id, trx);
		if (!orderRow) {
			const totalPrice = Number(product.currentPrice || product.startPrice || 0);
			const [inserted] = await trx('orders')
				.insert({
					product_id: product.id,
					seller_id: product.seller.id,
					buyer_id: buyerId,
					total_price: totalPrice,
					status: ORDER_STATUSES.AWAITING_PAYMENT_DETAILS,
					created_at: trx.fn.now(),
					updated_at: trx.fn.now(),
				})
				.returning('*');
			orderRow = inserted;
		}
		return getOrderContextByRow(orderRow, { chatLimit, trx });
	});
}

async function submitOrderPaymentDetails({
	orderId,
	buyerId,
	billingAddress,
	shippingAddress,
	paymentMethod,
	paymentProof,
	note,
}) {
	if (!orderId || !buyerId) {
		throw new Error('ORDER_PAYMENT_INVALID_INPUT');
	}
	await ensureOrderStatusEnumValues();
	const db = getKnex();
	const trimmedPaymentMethod = (paymentMethod || '').trim();
	const trimmedBilling = (billingAddress || '').trim();
	const trimmedShipping = (shippingAddress || '').trim();
	if (!trimmedPaymentMethod || !trimmedShipping) {
		throw new Error('ORDER_PAYMENT_DETAILS_REQUIRED');
	}
	return db.transaction(async (trx) => {
		const order = await trx('orders').where({ id: orderId }).forUpdate().first();
		if (!order) {
			throw new Error('ORDER_NOT_FOUND');
		}
		if (String(order.buyer_id) !== String(buyerId)) {
			throw new Error('ORDER_FORBIDDEN');
		}
		if (order.status !== ORDER_STATUSES.AWAITING_PAYMENT_DETAILS) {
			throw new Error('ORDER_INVALID_STATE');
		}
		await trx('order_invoices').insert({
			order_id: orderId,
			billing_address: trimmedBilling || null,
			shipping_address: trimmedShipping || null,
			payment_method: trimmedPaymentMethod || null,
			payment_proof: paymentProof || null,
			note: note || null,
			created_at: trx.fn.now(),
		});
		await trx('orders')
			.where({ id: orderId })
			.update({ status: ORDER_STATUSES.PAYMENT_CONFIRMED_AWAITING_DELIVERY, updated_at: trx.fn.now() });
	});
}

async function sellerConfirmPaymentAndShipment({
	orderId,
	sellerId,
	carrier,
	trackingNumber,
	shippingDate,
	invoiceUrl,
	shipmentProofImages,
}) {
	if (!orderId || !sellerId) {
		throw new Error('ORDER_SHIPMENT_INVALID_INPUT');
	}
	await ensureOrderStatusEnumValues();
	const db = getKnex();
	return db.transaction(async (trx) => {
		const order = await trx('orders').where({ id: orderId }).forUpdate().first();
		if (!order) {
			throw new Error('ORDER_NOT_FOUND');
		}
		if (String(order.seller_id) !== String(sellerId)) {
			throw new Error('ORDER_FORBIDDEN');
		}
		if (order.status !== ORDER_STATUSES.PAYMENT_CONFIRMED_AWAITING_DELIVERY) {
			throw new Error('ORDER_INVALID_STATE');
		}
		await trx('order_shipments').insert({
			order_id: orderId,
			carrier: carrier || null,
			tracking_number: trackingNumber || null,
			shipping_date: shippingDate || trx.fn.now(),
			invoice_url: invoiceUrl || null,
			proof_images: shipmentProofImages || null,
			created_at: trx.fn.now(),
		});
		await trx('orders')
			.where({ id: orderId })
			.update({ status: ORDER_STATUSES.DELIVERY_CONFIRMED_READY_TO_RATE, updated_at: trx.fn.now() });
	});
}

async function buyerConfirmDelivery({ orderId, buyerId }) {
	if (!orderId || !buyerId) {
		throw new Error('ORDER_DELIVERY_INVALID_INPUT');
	}
	await ensureOrderStatusEnumValues();
	const db = getKnex();
	return db.transaction(async (trx) => {
		const order = await trx('orders').where({ id: orderId }).forUpdate().first();
		if (!order) {
			throw new Error('ORDER_NOT_FOUND');
		}
		if (String(order.buyer_id) !== String(buyerId)) {
			throw new Error('ORDER_FORBIDDEN');
		}
		if (order.status !== ORDER_STATUSES.DELIVERY_CONFIRMED_READY_TO_RATE) {
			throw new Error('ORDER_INVALID_STATE');
		}
		await trx('orders')
			.where({ id: orderId })
			.update({ status: ORDER_STATUSES.TRANSACTION_COMPLETED, updated_at: trx.fn.now() });
	});
}

async function upsertOrderRating({ orderId, productId, fromUserId, toUserId, score, comment }, trx) {
	const numericScore = Number(score);
	if (!orderId || !productId || !fromUserId || !toUserId) {
		throw new Error('RATING_INVALID_INPUT');
	}
	if (![1, -1].includes(numericScore)) {
		throw new Error('RATING_INVALID_SCORE');
	}
	if (trx) {
		return upsertOrderRatingWithTransaction({ orderId, productId, fromUserId, toUserId, score: numericScore, comment }, trx);
	}
	const db = getKnex();
	return db.transaction((nestedTrx) =>
		upsertOrderRatingWithTransaction({ orderId, productId, fromUserId, toUserId, score: numericScore, comment }, nestedTrx)
	);
}

async function upsertOrderRatingWithTransaction({ orderId, productId, fromUserId, toUserId, score, comment }, trx) {
	const existing = await trx('ratings')
		.where({ from_user_id: fromUserId, to_user_id: toUserId, product_id: productId })
		.first();
	await trx('ratings')
		.insert({
			from_user_id: fromUserId,
			to_user_id: toUserId,
			product_id: productId,
			score,
			comment: comment || null,
			created_at: trx.fn.now(),
		})
		.onConflict(['from_user_id', 'to_user_id', 'product_id'])
		.merge({ score, comment: comment || null, created_at: trx.fn.now() });

	const posDelta = (score === 1 ? 1 : 0) - (existing?.score === 1 ? 1 : 0);
	const negDelta = (score === -1 ? 1 : 0) - (existing?.score === -1 ? 1 : 0);
	if (posDelta !== 0 || negDelta !== 0) {
		await trx('users')
			.where({ id: toUserId })
			.update({
				rating_pos: trx.raw('GREATEST(rating_pos + ?, 0)', [posDelta]),
				rating_neg: trx.raw('GREATEST(rating_neg + ?, 0)', [negDelta]),
				updated_at: trx.fn.now(),
			});
	}
}

async function appendOrderMessage({ orderId, senderId, message }) {
	if (!orderId || !senderId) {
		throw new Error('ORDER_CHAT_INVALID_INPUT');
	}
	const text = (message || '').trim();
	if (!text) {
		throw new Error('ORDER_CHAT_EMPTY');
	}
	const db = getKnex();
	await db('order_chats').insert({
		order_id: orderId,
		sender_id: senderId,
		message: text,
		created_at: db.fn.now(),
	});
}

async function cancelOrderBySeller({ orderId, sellerId, reason }) {
	if (!orderId || !sellerId) {
		throw new Error('ORDER_CANCEL_INVALID_INPUT');
	}
	await ensureOrderStatusEnumValues();
	const db = getKnex();
	return db.transaction(async (trx) => {
		const order = await trx('orders').where({ id: orderId }).forUpdate().first();
		if (!order) {
			throw new Error('ORDER_NOT_FOUND');
		}
		if (String(order.seller_id) !== String(sellerId)) {
			throw new Error('ORDER_FORBIDDEN');
		}
		if (!ORDER_CANCELABLE_STATUSES.has(order.status)) {
			throw new Error('ORDER_INVALID_STATE');
		}
		await trx('orders')
			.where({ id: orderId })
			.update({
				status: ORDER_STATUSES.CANCELED_BY_SELLER,
				cancel_reason: reason || null,
				updated_at: trx.fn.now(),
			});

		if (order.buyer_id) {
			await upsertOrderRating(
				{
					orderId,
					productId: order.product_id,
					fromUserId: sellerId,
					toUserId: order.buyer_id,
					score: -1,
					comment: reason || 'Người bán huỷ giao dịch',
				},
				trx
			);
		}
	});
}

function getOrderWorkflowMetadata() {
	return [
		{
			id: 'payment',
			title: 'Cung cấp thông tin thanh toán và giao hàng',
			actor: 'buyer',
			status: ORDER_STATUSES.AWAITING_PAYMENT_DETAILS,
			statusLabel: translateOrderStatus(ORDER_STATUSES.AWAITING_PAYMENT_DETAILS),
			description: 'Người thắng đấu giá cung cấp địa chỉ giao nhận và phương thức thanh toán để người bán kiểm chứng.',
		},
		{
			id: 'seller-confirm',
			title: 'Xác nhận thanh toán và gửi hàng',
			actor: 'seller',
			status: ORDER_STATUSES.PAYMENT_CONFIRMED_AWAITING_DELIVERY,
			statusLabel: translateOrderStatus(ORDER_STATUSES.PAYMENT_CONFIRMED_AWAITING_DELIVERY),
			description: 'Người bán xác nhận đã nhận đủ tiền, cung cấp mã vận đơn và chứng từ vận chuyển.',
		},
		{
			id: 'delivery',
			title: 'Người mua xác nhận đã nhận hàng',
			actor: 'buyer',
			status: ORDER_STATUSES.DELIVERY_CONFIRMED_READY_TO_RATE,
			statusLabel: translateOrderStatus(ORDER_STATUSES.DELIVERY_CONFIRMED_READY_TO_RATE),
			description: 'Người mua xác nhận đã nhận hàng để mở form đánh giá.',
		},
		{
			id: 'feedback',
			title: 'Đánh giá chất lượng giao dịch',
			actor: 'both',
			status: ORDER_STATUSES.TRANSACTION_COMPLETED,
			statusLabel: translateOrderStatus(ORDER_STATUSES.TRANSACTION_COMPLETED),
			description: 'Hai bên có thể đánh giá và chỉnh sửa điểm bất cứ lúc nào.',
		},
	];
}

function canSellerCancelOrder(status) {
	if (!status) return false;
	return ORDER_CANCELABLE_STATUSES.has(status);
}

module.exports = {
	ORDER_STATUSES,
	ORDER_STATUS_FLOW,
	ORDER_STATUS_LABELS,
	DEFAULT_CHAT_HISTORY_LIMIT,
	translateOrderStatus,
	ensureOrderStatusEnumValues,
	getOrderById,
	getOrderByProductId,
	ensureOrderForProduct,
	submitOrderPaymentDetails,
	sellerConfirmPaymentAndShipment,
	buyerConfirmDelivery,
	cancelOrderBySeller,
	appendOrderMessage,
	upsertOrderRating,
	listOrderMessages,
	getOrderWorkflowMetadata,
	canSellerCancelOrder,
};
