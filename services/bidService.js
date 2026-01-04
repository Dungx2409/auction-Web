const { getKnex } = require('./shared/dbUtils');
const { baseProductQuery, applyActiveSellerFilter, hydrateProducts } = require('./productService');

async function getWatchlistForUser(userId) {
	if (!userId) return [];
	const db = getKnex();
	const query = baseProductQuery(db)
		.innerJoin('watchlists as w', 'w.product_id', 'p.id')
		.where('w.user_id', userId)
		.orderBy('w.created_at', 'desc')
		.select('w.created_at as watch_created_at');
	applyActiveSellerFilter(query);
	const rows = await query;

	const products = await hydrateProducts(rows);
	return products.map((product, index) => ({
		addedAt: rows[index].watch_created_at,
		product: {
			...product,
			isWatching: true,
		},
	}));
}

async function getWatchlistProductIds(userId) {
	if (!userId) return [];
	const db = getKnex();
	const rows = await db('watchlists').select('product_id').where('user_id', userId);
	return rows.map((row) => String(row.product_id));
}

async function countWatchersForProduct(productId) {
	if (!productId) return 0;
	const db = getKnex();
	const result = await db('watchlists').where('product_id', productId).count({ count: '*' }).first();
	return Number(result?.count ?? result?.cnt ?? result?.total ?? 0);
}

async function addToWatchlist(userId, productId) {
	if (!userId || !productId) return { isWatching: false, watchers: 0 };
	const db = getKnex();
	await db('watchlists')
		.insert({
			user_id: userId,
			product_id: productId,
			created_at: db.fn.now(),
		})
		.onConflict(['user_id', 'product_id'])
		.merge({ created_at: db.fn.now() });

	const watchers = await countWatchersForProduct(productId);
	return { isWatching: true, watchers };
}

async function removeFromWatchlist(userId, productId) {
	if (!userId || !productId) return { isWatching: false, watchers: 0 };
	const db = getKnex();
	await db('watchlists').where({ user_id: userId, product_id: productId }).del();
	const watchers = await countWatchersForProduct(productId);
	return { isWatching: false, watchers };
}

function mapBidRequest(row) {
	if (!row) return null;
	return {
		id: row.id,
		productId: row.product_id,
		bidderId: row.bidder_id,
		status: row.status,
		message: row.message,
		sellerNote: row.seller_note,
		approvedBy: row.approved_by,
		respondedAt: row.responded_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function getBidRequest(productId, bidderId) {
	if (!productId || !bidderId) return null;
	const db = getKnex();
	const row = await db('bid_requests')
		.where({ product_id: productId, bidder_id: bidderId })
		.first();
	return mapBidRequest(row);
}

async function getBidRequestsBySeller(sellerId, { status } = {}) {
	if (!sellerId) return [];
	const db = getKnex();
	const rows = await db('bid_requests as r')
		.leftJoin('products as p', 'p.id', 'r.product_id')
		.leftJoin('users as b', 'b.id', 'r.bidder_id')
		.select(
			'r.id',
			'r.product_id',
			'r.bidder_id',
			'r.status',
			'r.message',
			'r.seller_note',
			'r.created_at',
			'r.responded_at',
			'p.title as product_title',
			'b.full_name as bidder_name',
			'b.email as bidder_email',
			'b.rating_pos as bidder_rating_pos',
			'b.rating_neg as bidder_rating_neg'
		)
		.where('p.seller_id', sellerId)
		.modify((qb) => {
			if (status) {
				qb.where('r.status', status);
			}
		})
		.orderBy('r.created_at', 'asc');

	return rows.map((row) => ({
		id: row.id,
		status: row.status,
		message: row.message,
		productId: row.product_id,
		productTitle: row.product_title,
		bidderId: row.bidder_id,
		bidderName: row.bidder_name || 'Người mua',
		bidderEmail: row.bidder_email,
		bidderRatingPlus: Number(row.bidder_rating_pos || 0),
		bidderRatingMinus: Number(row.bidder_rating_neg || 0),
		createdAt: row.created_at,
		respondedAt: row.responded_at,
		sellerNote: row.seller_note,
	}));
}

async function createBidRequest({ productId, bidderId, message }) {
	if (!productId || !bidderId) {
		throw new Error('MISSING_BID_REQUEST_INFO');
	}
	const db = getKnex();
	const trimmedMessage = typeof message === 'string' ? message.trim().slice(0, 800) : null;
	const existing = await db('bid_requests')
		.where({ product_id: productId, bidder_id: bidderId })
		.first();

	if (existing) {
		if (existing.status === 'approved') {
			return { request: mapBidRequest(existing), status: 'approved', updated: false };
		}

		const nextPayload = {
			message: trimmedMessage,
			updated_at: db.fn.now(),
		};

		if (existing.status === 'rejected') {
			nextPayload.status = 'pending';
			nextPayload.seller_note = null;
			nextPayload.approved_by = null;
			nextPayload.responded_at = null;
		}

		await db('bid_requests').where({ id: existing.id }).update(nextPayload);
		const updatedRow = await db('bid_requests').where({ id: existing.id }).first();
		return { request: mapBidRequest(updatedRow), status: updatedRow.status, updated: true };
	}

	const [inserted] = await db('bid_requests')
		.insert({
			product_id: productId,
			bidder_id: bidderId,
			status: 'pending',
			message: trimmedMessage,
			created_at: db.fn.now(),
			updated_at: db.fn.now(),
		})
		.returning('*');
	return { request: mapBidRequest(inserted), status: 'pending', created: true };
}

async function updateBidRequestStatus({ requestId, sellerId, action, note }) {
	if (!requestId || !sellerId) {
		throw new Error('MISSING_BID_REQUEST_INFO');
	}
	const db = getKnex();
	const normalizedAction = action === 'approve' || action === 'approved' ? 'approved' : 'rejected';
	const row = await db('bid_requests as r')
		.leftJoin('products as p', 'p.id', 'r.product_id')
		.leftJoin('users as b', 'b.id', 'r.bidder_id')
		.select(
			'r.id',
			'r.product_id',
			'r.bidder_id',
			'p.seller_id',
			'p.title as product_title',
			'b.full_name as bidder_name',
			'b.email as bidder_email'
		)
		.where('r.id', requestId)
		.first();

	if (!row) {
		const error = new Error('BID_REQUEST_NOT_FOUND');
		error.code = 'BID_REQUEST_NOT_FOUND';
		throw error;
	}

	if (String(row.seller_id) !== String(sellerId)) {
		const error = new Error('NOT_PRODUCT_OWNER');
		error.code = 'NOT_PRODUCT_OWNER';
		throw error;
	}

	const sellerNote = note ? note.trim().slice(0, 800) : null;

	await db('bid_requests')
		.where({ id: requestId })
		.update({
			status: normalizedAction,
			seller_note: sellerNote,
			approved_by: normalizedAction === 'approved' ? sellerId : null,
			responded_at: db.fn.now(),
			updated_at: db.fn.now(),
		});

	const updated = await db('bid_requests').where({ id: requestId }).first();
	return {
		...mapBidRequest(updated),
		productId: row.product_id,
		productTitle: row.product_title,
		bidderId: row.bidder_id,
		bidderName: row.bidder_name,
		bidderEmail: row.bidder_email,
		sellerNote,
		approved: normalizedAction === 'approved',
	};
}

async function placeBid({ productId, bidderId, amount }) {
	if (!productId || !bidderId || !Number.isFinite(Number(amount))) {
		throw new Error('INVALID_BID_INPUT');
	}

	const numericAmount = Number(amount);
	const db = getKnex();

	return db.transaction(async (trx) => {
		const product = await trx('products').where({ id: productId }).forUpdate().first();
		if (!product) {
			const notFoundError = new Error('PRODUCT_NOT_FOUND');
			notFoundError.code = 'PRODUCT_NOT_FOUND';
			throw notFoundError;
		}

		const nextBidCount = Number(product.bid_count || 0) + 1;

		await trx('bids').insert({
			product_id: productId,
			bidder_id: bidderId,
			bid_price: numericAmount,
			created_at: trx.fn.now(),
		});

		await trx('products')
			.where({ id: productId })
			.update({
				current_price: numericAmount,
				bid_count: nextBidCount,
				updated_at: trx.fn.now(),
			});

		return {
			productId,
			bidderId,
			amount: numericAmount,
			bidCount: nextBidCount,
		};
	});
}

async function isBidderRejected(productId, bidderId) {
	if (!productId || !bidderId) return false;
	const db = getKnex();
	const rejection = await db('bid_rejections')
		.where({ product_id: productId, bidder_id: bidderId })
		.first();
	return Boolean(rejection);
}

async function rejectBidder({ productId, bidderId, sellerId, reason }) {
	if (!productId || !bidderId || !sellerId) {
		throw new Error('MISSING_REJECT_INFO');
	}

	const db = getKnex();

	// Kiểm tra sản phẩm thuộc về seller
	const product = await db('products').where({ id: productId }).first();
	if (!product) {
		const error = new Error('PRODUCT_NOT_FOUND');
		error.code = 'PRODUCT_NOT_FOUND';
		throw error;
	}

	if (String(product.seller_id) !== String(sellerId)) {
		const error = new Error('NOT_PRODUCT_OWNER');
		error.code = 'NOT_PRODUCT_OWNER';
		throw error;
	}

	// Kiểm tra xem đã reject chưa
	const existing = await db('bid_rejections')
		.where({ product_id: productId, bidder_id: bidderId })
		.first();

	if (existing) {
		return { alreadyRejected: true };
	}

	return db.transaction(async (trx) => {
		// Thêm vào bảng bid_rejections
		await trx('bid_rejections').insert({
			product_id: productId,
			bidder_id: bidderId,
			reason: reason ? reason.trim().slice(0, 500) : null,
			created_at: trx.fn.now(),
		});

		// Lấy thông tin bidder bị reject
		const rejectedBidder = await trx('users').where({ id: bidderId }).first();

		// Kiểm tra nếu bidder bị reject đang là người đặt giá cao nhất
		const highestBid = await trx('bids')
			.where({ product_id: productId })
			.orderBy('bid_price', 'desc')
			.orderBy('created_at', 'asc')
			.first();

		let newHighestBidder = null;
		let previousPrice = product.current_price;

		if (highestBid && String(highestBid.bidder_id) === String(bidderId)) {
			// Tìm bid cao thứ nhì (không phải của bidder bị reject)
			const secondHighestBid = await trx('bids')
				.where({ product_id: productId })
				.whereNot({ bidder_id: bidderId })
				.orderBy('bid_price', 'desc')
				.orderBy('created_at', 'asc')
				.first();

			if (secondHighestBid) {
				// Cập nhật giá hiện tại về bid cao thứ nhì
				await trx('products')
					.where({ id: productId })
					.update({
						current_price: secondHighestBid.bid_price,
						updated_at: trx.fn.now(),
					});

				const secondBidder = await trx('users').where({ id: secondHighestBid.bidder_id }).first();
				newHighestBidder = {
					id: secondHighestBid.bidder_id,
					name: secondBidder?.full_name || 'Ẩn danh',
					email: secondBidder?.email,
					bidAmount: secondHighestBid.bid_price,
				};
			} else {
				// Không có bid khác, reset về giá khởi điểm
				await trx('products')
					.where({ id: productId })
					.update({
						current_price: product.start_price,
						updated_at: trx.fn.now(),
					});
			}
		}

		return {
			rejected: true,
			rejectedBidder: {
				id: bidderId,
				name: rejectedBidder?.full_name || 'Ẩn danh',
				email: rejectedBidder?.email,
			},
			wasHighestBidder: highestBid && String(highestBid.bidder_id) === String(bidderId),
			newHighestBidder,
			previousPrice,
			productTitle: product.title,
		};
	});
}

async function getRejectedBiddersForProduct(productId) {
	if (!productId) return [];
	const db = getKnex();
	const rows = await db('bid_rejections as r')
		.leftJoin('users as u', 'u.id', 'r.bidder_id')
		.select('r.id', 'r.bidder_id', 'r.reason', 'r.created_at', 'u.full_name as bidder_name', 'u.email as bidder_email')
		.where('r.product_id', productId)
		.orderBy('r.created_at', 'desc');

	return rows.map((row) => ({
		id: row.id,
		bidderId: row.bidder_id,
		bidderName: row.bidder_name || 'Người mua',
		bidderEmail: row.bidder_email,
		reason: row.reason,
		createdAt: row.created_at,
	}));
}

async function unrejectBidder({ productId, bidderId, sellerId }) {
	if (!productId || !bidderId || !sellerId) {
		throw new Error('MISSING_UNREJECT_INFO');
	}

	const db = getKnex();

	// Kiểm tra sản phẩm thuộc về seller
	const product = await db('products').where({ id: productId }).first();
	if (!product) {
		const error = new Error('PRODUCT_NOT_FOUND');
		error.code = 'PRODUCT_NOT_FOUND';
		throw error;
	}

	if (String(product.seller_id) !== String(sellerId)) {
		const error = new Error('NOT_PRODUCT_OWNER');
		error.code = 'NOT_PRODUCT_OWNER';
		throw error;
	}

	// Kiểm tra xem có trong danh sách từ chối không
	const existing = await db('bid_rejections')
		.where({ product_id: productId, bidder_id: bidderId })
		.first();

	if (!existing) {
		return { notFound: true };
	}

	// Xóa khỏi bảng bid_rejections
	await db('bid_rejections')
		.where({ product_id: productId, bidder_id: bidderId })
		.del();

	// Lấy thông tin bidder
	const bidder = await db('users').where({ id: bidderId }).first();

	return {
		success: true,
		bidder: {
			id: bidderId,
			name: bidder?.full_name || 'Ẩn danh',
			email: bidder?.email,
		},
		productTitle: product.title,
	};
}

// ========== Auto-Bid Functions ==========

/**
 * Get auto-bid setting for a user on a product
 */
async function getAutoBid(productId, bidderId) {
	if (!productId || !bidderId) return null;
	const db = getKnex();
	const row = await db('auto_bids')
		.where({ product_id: productId, bidder_id: bidderId })
		.first();
	if (!row) return null;
	return {
		id: row.id,
		productId: row.product_id,
		bidderId: row.bidder_id,
		maxPrice: Number(row.max_price),
		createdAt: row.created_at,
	};
}

/**
 * Set or update auto-bid for a user on a product
 */
async function setAutoBid({ productId, bidderId, maxPrice }) {
	if (!productId || !bidderId || !Number.isFinite(Number(maxPrice))) {
		throw new Error('INVALID_AUTO_BID_INPUT');
	}

	const numericMaxPrice = Number(maxPrice);
	if (numericMaxPrice <= 0) {
		throw new Error('MAX_PRICE_MUST_BE_POSITIVE');
	}

	const db = getKnex();

	// Validate product exists and is active
	const product = await db('products').where({ id: productId }).first();
	if (!product) {
		const error = new Error('PRODUCT_NOT_FOUND');
		error.code = 'PRODUCT_NOT_FOUND';
		throw error;
	}

	if (product.status !== 'active') {
		const error = new Error('AUCTION_NOT_ACTIVE');
		error.code = 'AUCTION_NOT_ACTIVE';
		throw error;
	}

	// Check if auction has ended by time
	if (product.end_time && new Date(product.end_time) <= new Date()) {
		const error = new Error('AUCTION_ENDED');
		error.code = 'AUCTION_ENDED';
		throw error;
	}

	// Check seller cannot bid on own product
	if (String(product.seller_id) === String(bidderId)) {
		const error = new Error('CANNOT_BID_OWN_PRODUCT');
		error.code = 'CANNOT_BID_OWN_PRODUCT';
		throw error;
	}

	const currentPrice = Number(product.current_price || product.start_price || 0);
	const bidStep = Number(product.step_price || 0);

	// Max price must be at least current price + bid step (or start price if no bids)
	const minRequired = product.bid_count > 0 ? currentPrice + bidStep : currentPrice;
	if (numericMaxPrice < minRequired) {
		const error = new Error('MAX_PRICE_TOO_LOW');
		error.code = 'MAX_PRICE_TOO_LOW';
		error.minRequired = minRequired;
		throw error;
	}

	// Insert or update auto-bid
	await db('auto_bids')
		.insert({
			product_id: productId,
			bidder_id: bidderId,
			max_price: numericMaxPrice,
			created_at: db.fn.now(),
		})
		.onConflict(['product_id', 'bidder_id'])
		.merge({
			max_price: numericMaxPrice,
			created_at: db.fn.now(),
		});

	return {
		productId,
		bidderId,
		maxPrice: numericMaxPrice,
	};
}

/**
 * Remove auto-bid for a user on a product
 */
async function removeAutoBid(productId, bidderId) {
	if (!productId || !bidderId) return false;
	const db = getKnex();
	const deleted = await db('auto_bids')
		.where({ product_id: productId, bidder_id: bidderId })
		.del();
	return deleted > 0;
}

/**
 * Process auto-bids after a new bid is placed
 * This is the core logic for automatic bidding
 * Returns immediately after placing ONE auto-bid response
 */
async function processAutoBids({ productId, currentBidAmount, currentBidderId }) {
	const db = getKnex();

	// Get product info
	const product = await db('products').where({ id: productId }).first();
	if (!product || product.status !== 'active') {
		return { processed: false, reason: 'PRODUCT_NOT_ACTIVE' };
	}

	// Check if auction ended by time
	if (product.end_time && new Date(product.end_time) <= new Date()) {
		return { processed: false, reason: 'AUCTION_ENDED' };
	}

	const bidStep = Number(product.step_price || 0);
	const currentPrice = Number(currentBidAmount);

	// Get all active auto-bids for this product that can still compete
	// (max_price > current price + bid step, meaning they can outbid)
	const allAutoBids = await db('auto_bids')
		.where('product_id', productId)
		.where('max_price', '>=', currentPrice + bidStep)
		.orderBy('max_price', 'desc')
		.orderBy('created_at', 'asc');

	if (!allAutoBids.length) {
		return { processed: false, reason: 'NO_VALID_AUTO_BIDS' };
	}

	// Find auto-bids excluding current bidder
	const competingAutoBids = allAutoBids.filter(
		ab => String(ab.bidder_id) !== String(currentBidderId)
	);

	if (!competingAutoBids.length) {
		// Current bidder is the only one with auto-bid, no action needed
		return { processed: false, reason: 'NO_COMPETING_AUTO_BIDS' };
	}

	// The highest competing auto-bid
	const highestCompeting = competingAutoBids[0];
	const highestMaxPrice = Number(highestCompeting.max_price);
	const highestBidderId = highestCompeting.bidder_id;

	// Check if current bidder also has auto-bid
	const currentBidderAutoBid = allAutoBids.find(
		ab => String(ab.bidder_id) === String(currentBidderId)
	);
	const currentBidderMaxPrice = currentBidderAutoBid 
		? Number(currentBidderAutoBid.max_price) 
		: currentPrice;

	// If current bidder's max price is higher or equal, no auto-bid needed
	// (current bidder is already winning or will continue to win)
	if (currentBidderMaxPrice >= highestMaxPrice) {
		// But if they're equal, the one who set auto-bid first wins
		if (currentBidderMaxPrice === highestMaxPrice) {
			// Check who set it first
			const currentCreatedAt = currentBidderAutoBid?.created_at;
			const competingCreatedAt = highestCompeting.created_at;
			if (currentCreatedAt && new Date(currentCreatedAt) <= new Date(competingCreatedAt)) {
				return { processed: false, reason: 'CURRENT_BIDDER_HAS_PRIORITY' };
			}
		} else {
			return { processed: false, reason: 'CURRENT_BIDDER_MAX_HIGHER' };
		}
	}

	// Calculate the auto-bid amount
	// Bid just enough to beat the current price, but not more than max
	let autoBidAmount = currentPrice + bidStep;

	// If current bidder has auto-bid, we need to beat their max
	if (currentBidderMaxPrice > currentPrice) {
		autoBidAmount = Math.min(currentBidderMaxPrice + bidStep, highestMaxPrice);
	}

	// Make sure we don't exceed our max
	if (autoBidAmount > highestMaxPrice) {
		autoBidAmount = highestMaxPrice;
	}

	// Make sure it's higher than current price
	if (autoBidAmount <= currentPrice) {
		return { processed: false, reason: 'CANNOT_OUTBID' };
	}

	// Place the automatic bid
	return db.transaction(async (trx) => {
		// Re-fetch product with lock
		const latestProduct = await trx('products').where({ id: productId }).forUpdate().first();
		const latestPrice = Number(latestProduct.current_price || latestProduct.start_price);

		// Re-check if our auto-bid is still valid
		if (autoBidAmount <= latestPrice) {
			return { processed: false, reason: 'PRICE_ALREADY_HIGHER' };
		}

		// Re-check max price is still sufficient
		if (autoBidAmount > highestMaxPrice) {
			return { processed: false, reason: 'AUTO_BID_MAX_EXCEEDED' };
		}

		const nextBidCount = Number(latestProduct.bid_count || 0) + 1;

		// Insert auto bid with is_auto flag
		await trx('bids').insert({
			product_id: productId,
			bidder_id: highestBidderId,
			bid_price: autoBidAmount,
			is_auto: true,
			created_at: trx.fn.now(),
		});

		// Update product price
		await trx('products')
			.where({ id: productId })
			.update({
				current_price: autoBidAmount,
				bid_count: nextBidCount,
				updated_at: trx.fn.now(),
			});

		return {
			processed: true,
			autoBid: {
				bidderId: highestBidderId,
				amount: autoBidAmount,
				bidCount: nextBidCount,
			},
		};
	});
}

/**
 * Get all active auto-bids for a product (for admin/seller view)
 */
async function getAutoBidsForProduct(productId) {
	if (!productId) return [];
	const db = getKnex();
	const rows = await db('auto_bids as ab')
		.leftJoin('users as u', 'u.id', 'ab.bidder_id')
		.where('ab.product_id', productId)
		.select(
			'ab.id',
			'ab.product_id',
			'ab.bidder_id',
			'ab.max_price',
			'ab.created_at',
			'u.full_name as bidder_name'
		)
		.orderBy('ab.max_price', 'desc')
		.orderBy('ab.created_at', 'asc');

	return rows.map(row => ({
		id: row.id,
		productId: row.product_id,
		bidderId: row.bidder_id,
		bidderName: row.bidder_name || `User #${row.bidder_id}`,
		maxPrice: Number(row.max_price),
		createdAt: row.created_at,
	}));
}

module.exports = {
	getWatchlistForUser,
	getWatchlistProductIds,
	addToWatchlist,
	removeFromWatchlist,
	countWatchersForProduct,
	placeBid,
	getBidRequest,
	getBidRequestsBySeller,
	createBidRequest,
	updateBidRequestStatus,
	isBidderRejected,
	rejectBidder,
	unrejectBidder,
	getRejectedBiddersForProduct,
	// Auto-bid functions
	getAutoBid,
	setAutoBid,
	removeAutoBid,
	processAutoBids,
	getAutoBidsForProduct,
};
