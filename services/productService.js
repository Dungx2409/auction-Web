const { getKnex, toNumber } = require('./shared/dbUtils');
const { ORDER_STATUSES } = require('./orderService');

const DEFAULT_IMAGE =
	'https://images.unsplash.com/photo-1515165562835-c4c42b6b8663?auto=format&fit=crop&w=800&q=80';

let categoryTreeCache = null;
let categoryMapCache = null;

async function ensureCategoryCache() {
	if (categoryTreeCache && categoryMapCache) {
		return;
	}
	const db = getKnex();
	const rows = await db('categories')
		.select('id', 'name', 'parent_id', 'description')
		.orderBy('parent_id', 'asc')
		.orderBy('name', 'asc');

	const map = new Map();
	rows.forEach((row) => {
		const id = String(row.id);
		const parentId = row.parent_id != null ? String(row.parent_id) : null;
		map.set(id, {
			id,
			name: row.name,
			description: row.description,
			parentId,
			children: [],
		});
	});

	const roots = [];
	map.forEach((node) => {
		if (node.parentId) {
			const parent = map.get(node.parentId);
			if (parent) {
				parent.children.push(node);
			}
		} else {
			roots.push(node);
		}
	});

	categoryTreeCache = roots.map((node) => ({
		id: node.id,
		name: node.name,
		description: node.description,
		children: node.children.map((child) => ({
			id: child.id,
			name: child.name,
			description: child.description,
		})),
	}));

	categoryMapCache = map;
}

function resetCategoryCache() {
	categoryTreeCache = null;
	categoryMapCache = null;
}

function buildCategoryPath(categoryId) {
	if (!categoryId || !categoryMapCache) return [];
	const path = [];
	let cursor = categoryMapCache.get(String(categoryId));
	while (cursor) {
		path.unshift({ id: cursor.id, name: cursor.name });
		cursor = cursor.parentId ? categoryMapCache.get(cursor.parentId) : null;
	}
	return path;
}

function baseProductQuery(db) {
	return db('products as p')
		.leftJoin('users as s', 's.id', 'p.seller_id')
		.select(
			'p.id',
			'p.seller_id',
			'p.category_id',
			'p.title',
			'p.short_description',
			'p.full_description',
			'p.start_price',
			'p.current_price',
			'p.step_price',
			'p.buy_now_price',
			'p.auto_extend',
			'p.start_time',
			'p.end_time',
			'p.status',
			'p.bid_count',
			'p.created_at',
			'p.updated_at',
			's.full_name as seller_name',
			's.email as seller_email',
			's.rating_pos as seller_rating_pos',
			's.rating_neg as seller_rating_neg',
			's.status as seller_status'
		);
}

function applyActiveSellerFilter(query) {
	return query.andWhere((builder) => {
		builder.whereNull('s.status').orWhere('s.status', '<>', 'banned');
	});
}

function applyProductSort(query, sort) {
	switch (sort) {
		case 'priceAsc':
			query.orderBy('p.current_price', 'asc');
			break;
		case 'priceDesc':
			query.orderBy('p.current_price', 'desc');
			break;
		case 'newest':
			query.orderBy('p.start_time', 'desc');
			break;
		case 'endingSoon':
		default:
			query.orderBy('p.end_time', 'asc');
			break;
	}
	query.orderBy('p.id', 'asc');
}

// Đánh dấu sản phẩm mới đăng (trong vòng 45 phút)
const NEW_PRODUCT_THRESHOLD_MINUTES = 45;

function markNewProducts(products) {
	const now = new Date();
	products.forEach(product => {
		const createdAt = product.startDate ? new Date(product.startDate) : null;
		if (createdAt) {
			const diffMinutes = (now.getTime() - createdAt.getTime()) / (1000 * 60);
			product.isNew = diffMinutes <= NEW_PRODUCT_THRESHOLD_MINUTES;
		} else {
			product.isNew = false;
		}
	});
	return products;
}

async function hydrateProducts(rows) {
	if (!rows.length) return [];
	const db = getKnex();
	await ensureCategoryCache();

	const productIds = rows.map((row) => row.id);

	const imagesRows = await db('product_images')
		.select('product_id', 'image_url', 'position')
		.whereIn('product_id', productIds)
		.orderBy('product_id', 'asc')
		.orderBy('position', 'asc')
		.orderBy('id', 'asc');

	const imageMap = new Map();
	imagesRows.forEach((image) => {
		if (!imageMap.has(image.product_id)) {
			imageMap.set(image.product_id, []);
		}
		imageMap.get(image.product_id).push(image.image_url);
	});

	const watchersRows = await db('watchlists')
		.select('product_id')
		.count({ count: '*' })
		.whereIn('product_id', productIds)
		.groupBy('product_id');

	const watcherMap = new Map();
	watchersRows.forEach((item) => {
		watcherMap.set(item.product_id, Number(item.count));
	});

	const latestBidRows = await db
		.select('b.product_id', 'b.bid_price', 'b.bidder_id', 'u.full_name as bidder_name', 'u.email as bidder_email', 'u.rating_pos', 'u.rating_neg')
		.from('bids as b')
		.leftJoin('users as u', 'u.id', 'b.bidder_id')
		.whereIn('b.product_id', productIds)
		.orderBy('b.product_id', 'asc')
		.orderBy('b.created_at', 'desc');

	const latestBidMap = new Map();
	latestBidRows.forEach((row) => {
		if (!latestBidMap.has(row.product_id)) {
			latestBidMap.set(row.product_id, row);
		}
	});

	return rows.map((row) => {
		const images = imageMap.get(row.id) || [DEFAULT_IMAGE];
		const watchers = watcherMap.get(row.id) ?? 0;
		const latestBid = latestBidMap.get(row.id);
		const sellerRatingPlus = Number(row.seller_rating_pos || 0);
		const sellerRatingMinus = Number(row.seller_rating_neg || 0);
		const ratingTotal = sellerRatingPlus + sellerRatingMinus;
		const ratingScore = ratingTotal > 0 ? Number(((sellerRatingPlus / ratingTotal) * 100).toFixed(1)) : 100;
		const sellerStatus = row.seller_status ? String(row.seller_status).toLowerCase() : 'active';

		return {
			id: String(row.id),
			title: row.title,
			summary: row.short_description,
			description: row.full_description,
			startPrice: toNumber(row.start_price),
			currentPrice: toNumber(row.current_price),
			bidStep: toNumber(row.step_price),
			buyNowPrice: row.buy_now_price != null ? toNumber(row.buy_now_price) : null,
			autoExtend: Boolean(row.auto_extend),
			startDate: row.start_time,
			endDate: row.end_time,
			status: row.status,
			bidCount: Number(row.bid_count || 0),
			categoryId: row.category_id,
			categoryPath: buildCategoryPath(row.category_id),
			images,
			watchers,
			highestBid: latestBid ? toNumber(latestBid.bid_price) : null,
			highestBidder: latestBid
				? {
						id: latestBid.bidder_id,
						name: latestBid.bidder_name || 'Ẩn danh',
						email: latestBid.bidder_email,
						ratingPlus: Number(latestBid.rating_pos || 0),
						ratingMinus: Number(latestBid.rating_neg || 0),
					}
				: {
						name: 'Chưa có',
						ratingPlus: 0,
						ratingMinus: 0,
					},
			shippingOptions: ['Liên hệ người bán để thỏa thuận'],
			paymentMethods: ['Chuyển khoản', 'Tiền mặt khi nhận hàng'],
			documents: [],
			seller: {
				id: row.seller_id,
				name: row.seller_name || 'Người bán',
				email: row.seller_email,
				ratingPlus: sellerRatingPlus,
				ratingMinus: sellerRatingMinus,
				ratingScore,
				status: sellerStatus,
				responseTime: '12 giờ',
				badges: sellerRatingPlus > 50 ? ['Uy tín', 'Giao nhanh'] : ['Uy tín'],
			},
		};
	});
}

async function getCategories() {
	await ensureCategoryCache();
	return categoryTreeCache || [];
}

async function getCategoryById(id) {
	if (!id) return null;
	await ensureCategoryCache();
	const key = String(id);
	const category = categoryMapCache?.get(key);
	if (!category) return null;
	const parentNode = category.parentId ? categoryMapCache.get(category.parentId) : null;
	return {
		id: category.id,
		name: category.name,
		parentId: category.parentId,
		parent: parentNode
			? {
					id: parentNode.id,
					name: parentNode.name,
				}
			: null,
	};
}

async function getProducts({ status = 'active', limit, sort = 'endingSoon' } = {}) {
	const db = getKnex();
	const query = baseProductQuery(db);
	applyActiveSellerFilter(query);
	if (status) {
		query.where('p.status', status);
	}
	applyProductSort(query, sort);
	if (limit) {
		query.limit(limit);
	}
	const rows = await query;
	return hydrateProducts(rows);
}

async function getProductsEndingSoon(limit = 5) {
	const db = getKnex();
	const now = new Date();
	const query = baseProductQuery(db)
		.where('p.status', 'active')
		.andWhere('p.end_time', '>', now)
		.orderBy('p.end_time', 'asc')
		.orderBy('p.id', 'asc')
		.limit(limit);
	applyActiveSellerFilter(query);
	const rows = await query;
	const products = await hydrateProducts(rows);
	return markNewProducts(products);
}

async function getProductsMostBids(limit = 5) {
	const db = getKnex();
	const query = baseProductQuery(db)
		.where('p.status', 'active')
		.orderBy('p.bid_count', 'desc')
		.orderBy('p.end_time', 'asc')
		.limit(limit);
	applyActiveSellerFilter(query);
	const rows = await query;
	const products = await hydrateProducts(rows);
	return markNewProducts(products);
}

async function getProductsHighestPrice(limit = 5) {
	const db = getKnex();
	const now = new Date();
	const query = baseProductQuery(db)
		.where('p.status', 'active')
		.andWhere('p.end_time', '>', now)
		.orderBy('p.current_price', 'desc')
		.orderBy('p.end_time', 'asc')
		.limit(limit);
	applyActiveSellerFilter(query);
	const rows = await query;
	const products = await hydrateProducts(rows);
	return markNewProducts(products);
}

async function getProductsByCategory(categoryId) {
	if (!categoryId) return [];
	const db = getKnex();
	const query = baseProductQuery(db)
		.where('p.status', 'active')
		.andWhere('p.category_id', categoryId)
		.orderBy('p.end_time', 'asc');
	applyActiveSellerFilter(query);
	const rows = await query;
	const products = await hydrateProducts(rows);
	return markNewProducts(products);
}

async function getProductsBySeller(sellerId, { status, includeOrders = false } = {}) {
	if (!sellerId) return [];
	const db = getKnex();
	const query = baseProductQuery(db)
		.where('p.seller_id', sellerId)
		.orderBy('p.created_at', 'desc');

	if (Array.isArray(status) && status.length) {
		query.whereIn('p.status', status);
	} else if (status) {
		query.andWhere('p.status', status);
	} else {
		// Default behavior: show all except removed (valid statuses: draft, active, ended, removed)
		query.whereIn('p.status', ['active', 'ended', 'draft']);
	}

	const rows = await query;
	let products = await hydrateProducts(rows);
	if (!includeOrders || !products.length) {
		return products;
	}

	const productIds = rows.map((row) => row.id).filter(Boolean);
	if (!productIds.length) {
		return products;
	}

	const orderRows = await db('orders as o')
		.leftJoin('ratings as r', function() {
			this.on('r.product_id', '=', 'o.product_id')
				.andOn('r.from_user_id', '=', db.raw('?', [sellerId]));
		})
		.select('o.id', 'o.product_id', 'o.status', 'o.total_price', 'o.created_at', 'o.updated_at', 'r.id as seller_rating_id')
		.whereIn('o.product_id', productIds);

	const orderMap = new Map();
	orderRows.forEach((order) => {
		orderMap.set(String(order.product_id), {
			id: String(order.id),
			status: order.status,
			totalPrice: toNumber(order.total_price),
			createdAt: order.created_at,
			updatedAt: order.updated_at,
			hasRated: Boolean(order.seller_rating_id),
		});
	});

	return products.map((product) => ({
		...product,
		order: orderMap.get(String(product.id)) || null,
	}));
}

async function getProductsByBidder(bidderId) {
	if (!bidderId) return [];
	const db = getKnex();

	const rows = await db('bids as b')
		.select('b.product_id')
		.where('b.bidder_id', bidderId)
		.groupBy('b.product_id')
		.orderByRaw('MAX(b.created_at) DESC');

	const productIds = rows.map((r) => r.product_id);
	if (!productIds.length) return [];

	const productsRows = await baseProductQuery(db)
		.whereIn('p.id', productIds)
		.orderBy('p.end_time', 'asc');

	// Get my max bid per product and the overall highest bid per product
	const [products, myBidRows, highestBidRows] = await Promise.all([
		hydrateProducts(productsRows),
		db('bids as b')
			.where('b.bidder_id', bidderId)
			.whereIn('b.product_id', productIds)
			.select('b.product_id')
			.max({ maxBid: 'b.bid_price' })
			.groupBy('b.product_id'),
		db('bids as b')
			.whereIn('b.product_id', productIds)
			.select('b.product_id')
			.max({ highestBid: 'b.bid_price' })
			.groupBy('b.product_id'),
	]);

	const myBidMap = new Map();
	myBidRows.forEach((row) => {
		const key = String(row.product_id);
		myBidMap.set(key, toNumber(row.maxBid));
	});

	const highestBidMap = new Map();
	highestBidRows.forEach((row) => {
		const key = String(row.product_id);
		highestBidMap.set(key, toNumber(row.highestBid));
	});

	return products.map((product) => {
		const myBid = myBidMap.get(String(product.id)) ?? null;
		const highestBid = highestBidMap.get(String(product.id)) ?? 0;
		const isWinning = myBid !== null && myBid >= highestBid;
		return {
			...product,
			myBid,
			isWinning,
		};
	});
}

async function getProductsWonByBidder(bidderId, { limit } = {}) {
	if (!bidderId) return [];
	const db = getKnex();
	const query = baseProductQuery(db)
		.innerJoin('orders as o', 'o.product_id', 'p.id')
		.where('o.buyer_id', bidderId)
		.orderBy('o.created_at', 'desc')
		.select(
			'o.id as order_id',
			'o.status as order_status',
			'o.total_price as order_total_price',
			'o.created_at as order_created_at',
			'o.updated_at as order_updated_at'
		);
	applyActiveSellerFilter(query);
	if (limit) {
		query.limit(limit);
	}
	const rows = await query;
	const products = await hydrateProducts(rows);
	
	// Get product IDs to fetch ratings
	const productIds = rows.map((row) => row.id).filter(Boolean);
	
	// Fetch ratings for these products by this bidder
	const ratingRows = productIds.length > 0 ? await db('ratings')
		.whereIn('product_id', productIds)
		.where('from_user_id', bidderId)
		.select('product_id', 'id as rating_id', 'score') : [];
	
	const ratingMap = new Map();
	ratingRows.forEach((rating) => {
		ratingMap.set(String(rating.product_id), {
			hasRated: true,
			ratingScore: rating.score,
		});
	});
	
	const orderMeta = new Map();
	rows.forEach((row) => {
		const ratingInfo = ratingMap.get(String(row.id)) || { hasRated: false, ratingScore: null };
		orderMeta.set(String(row.id), {
			id: row.order_id,
			status: row.order_status,
			totalPrice: toNumber(row.order_total_price),
			createdAt: row.order_created_at,
			updatedAt: row.order_updated_at,
			hasRated: ratingInfo.hasRated,
			ratingScore: ratingInfo.ratingScore,
		});
	});
	return products.map((product) => ({
		...product,
		order: orderMeta.get(String(product.id)) || null,
	}));
}

/**
 * Search products using Full-text search with pagination
 * @param {string} query - Search query text
 * @param {Object} options - Search options
 * @param {string} options.sort - Sort order: 'endingSoon', 'priceAsc', 'priceDesc', 'newest'
 * @param {string|number} options.categoryId - Filter by category ID
 * @param {number} options.page - Page number (1-indexed)
 * @param {number} options.limit - Items per page
 * @returns {Promise<{products: Array, total: number, page: number, totalPages: number}>}
 */
async function searchProducts(query, { sort = 'endingSoon', categoryId, page = 1, limit = 12 } = {}) {
	const db = getKnex();
	const offset = (page - 1) * limit;
	const now = new Date();

	// Build base query for products with category join for searching
	const builder = baseProductQuery(db)
		.leftJoin('categories as c', 'c.id', 'p.category_id')
		.where('p.status', 'active');
	applyActiveSellerFilter(builder);

	// Apply Full-text search if query is provided
	if (query && query.trim()) {
		const searchTerms = query.trim().split(/\s+/).filter(Boolean);
		// Use OR (|) instead of AND (&) to find products matching ANY term
		const tsQueryOr = searchTerms.map(term => `${term.replace(/'/g, "''")}:*`).join(' | ');
		const tsQueryAnd = searchTerms.map(term => `${term.replace(/'/g, "''")}:*`).join(' & ');
		const searchPattern = `%${query.trim()}%`;
		// Create patterns for each individual term
		const termPatterns = searchTerms.map(term => `%${term}%`);
		
		builder.andWhere(function() {
			// Full-text search using search_vector - match ANY term (more flexible)
			this.whereRaw(
				`p.search_vector @@ to_tsquery('simple', ?)`,
				[tsQueryOr]
			)
			// Search in title
			.orWhereILike('p.title', searchPattern)
			// Search in short_description
			.orWhereILike('p.short_description', searchPattern)
			// Search in full_description
			.orWhereILike('p.full_description', searchPattern)
			// Search in category name
			.orWhereILike('c.name', searchPattern);
			
			// Also search for each individual term
			termPatterns.forEach(pattern => {
				this.orWhereILike('p.title', pattern)
					.orWhereILike('p.short_description', pattern)
					.orWhereILike('c.name', pattern);
			});
		});

		// Add relevance ranking - prioritize matches with ALL terms, then ANY term
		builder.select(
			db.raw(`(
				CASE WHEN p.search_vector @@ to_tsquery('simple', ?) THEN 100 ELSE 0 END +
				CASE WHEN p.search_vector @@ to_tsquery('simple', ?) THEN 50 ELSE 0 END +
				CASE WHEN p.title ILIKE ? THEN 30 ELSE 0 END +
				CASE WHEN p.short_description ILIKE ? THEN 20 ELSE 0 END +
				CASE WHEN c.name ILIKE ? THEN 15 ELSE 0 END +
				ts_rank_cd(p.search_vector, to_tsquery('simple', ?), 32) * 10
			) as search_rank`, [tsQueryAnd, tsQueryOr, searchPattern, searchPattern, searchPattern, tsQueryOr])
		);
	}

	// Apply category filter
	if (categoryId) {
		// Check if this is a parent category and include all child categories
		await ensureCategoryCache();
		const category = categoryMapCache?.get(String(categoryId));
		const numericCategoryId = parseInt(categoryId, 10);
		
		if (category && category.children && category.children.length > 0) {
			// Parent category: include this category and all children
			const childIds = category.children.map(c => parseInt(c.id, 10));
			builder.andWhere(function() {
				this.where('p.category_id', numericCategoryId)
					.orWhereIn('p.category_id', childIds);
			});
		} else if (!isNaN(numericCategoryId)) {
			// Child category or no children: filter by exact category
			builder.andWhere('p.category_id', numericCategoryId);
		}
	}

	// Clone builder for count query before applying sort/limit
	const countBuilder = builder.clone();
	
	// Get total count
	const countResult = await countBuilder.clearSelect().count('p.id as total').first();
	const total = parseInt(countResult?.total || 0, 10);
	const totalPages = Math.ceil(total / limit);

	// Apply sorting
	if (query && query.trim()) {
		// When searching, prioritize relevance but allow user to override with explicit sort
		if (sort === 'relevance') {
			builder.orderBy('search_rank', 'desc');
		} else {
			applyProductSort(builder, sort);
		}
	} else {
		applyProductSort(builder, sort);
	}

	// Apply pagination
	builder.limit(limit).offset(offset);

	const rows = await builder;
	const products = await hydrateProducts(rows);

	// Mark new products
	markNewProducts(products);

	return {
		products,
		total,
		page,
		totalPages,
		limit,
	};
}

async function getProductById(id, { includeBannedSeller = false } = {}) {
	if (!id) return null;
	const db = getKnex();
	const query = baseProductQuery(db).where('p.id', id);
	if (!includeBannedSeller) {
		applyActiveSellerFilter(query);
	}
	const row = await query.first();
	if (!row) return null;
	const [product] = await hydrateProducts([row]);
	if (!product) return null;

	const bids = await db('bids as b')
		.leftJoin('users as u', 'u.id', 'b.bidder_id')
		.where('b.product_id', id)
		.orderBy('b.created_at', 'desc')
		.select('b.id', 'b.bidder_id', 'b.bid_price', 'b.created_at', 'u.full_name', 'u.rating_pos', 'u.rating_neg');

	product.bids = bids.map((bid) => ({
		id: bid.id,
		bidderId: bid.bidder_id,
		amount: toNumber(bid.bid_price),
		time: bid.created_at,
		userName: bid.full_name || 'Ẩn danh',
		ratingPlus: Number(bid.rating_pos || 0),
		ratingMinus: Number(bid.rating_neg || 0),
	}));

	const questionRows = await db('questions as q')
		.leftJoin('users as author', 'author.id', 'q.buyer_id')
		.where('q.product_id', id)
		.orderBy('q.created_at', 'desc')
		.select('q.id', 'q.question_text', 'q.created_at', 'author.full_name as author_name', 'author.id as author_id');

	const questionIds = questionRows.map((row) => row.id);
	const answersMap = new Map();

	if (questionIds.length) {
		const answerRows = await db('answers as a')
			.leftJoin('users as seller', 'seller.id', 'a.seller_id')
			.whereIn('a.question_id', questionIds)
			.orderBy('a.created_at', 'asc')
			.select('a.id', 'a.question_id', 'a.answer_text', 'a.created_at', 'seller.full_name as seller_name', 'seller.id as seller_id');

		answerRows.forEach((answer) => {
			if (!answersMap.has(answer.question_id)) {
				answersMap.set(answer.question_id, []);
			}
			answersMap.get(answer.question_id).push({
				id: answer.id,
				text: answer.answer_text,
				answeredBy: answer.seller_name || 'Người bán',
				answeredById: answer.seller_id,
				answeredAt: answer.created_at,
			});
		});
	}

	product.questions = questionRows.map((qa) => {
		const askedBySeller = qa.author_id && product?.seller?.id
			? String(qa.author_id) === String(product.seller.id)
			: false;
		return {
			id: qa.id,
			question: qa.question_text,
			askedBy: askedBySeller ? (product.seller?.name || 'Người bán') : (qa.author_name || 'Khách hàng'),
			askedById: qa.author_id,
			askedAt: qa.created_at,
			askedRole: askedBySeller ? 'seller' : 'buyer',
			answers: answersMap.get(qa.id) || [],
		};
	});

	if (!product.documents) {
		product.documents = [];
	}

	if (!product.shippingOptions) {
		product.shippingOptions = ['Liên hệ người bán để thỏa thuận'];
	}

	if (!product.paymentMethods) {
		product.paymentMethods = ['Chuyển khoản', 'Tiền mặt khi nhận hàng'];
	}

	return product;
}

async function getRelatedProducts(product, limit = 5) {
	if (!product?.categoryId) return [];
	const db = getKnex();
	const query = baseProductQuery(db)
		.where('p.status', 'active')
		.andWhere('p.category_id', product.categoryId)
		.andWhereNot('p.id', product.id)
		.orderBy('p.end_time', 'asc')
		.limit(limit);
	applyActiveSellerFilter(query);
	const rows = await query;
	return hydrateProducts(rows);
}

async function createProduct(payload) {
	const {
		sellerId,
		categoryId,
		title,
		shortDescription,
		fullDescription,
		startPrice,
		stepPrice,
		buyNowPrice = null,
		startDate,
		galleryUrls = [],
		endDate,
		autoExtend = true,
		status = 'active',
		imageUrl = null,
	} = payload;

	if (!sellerId) {
		throw new Error('Missing sellerId when creating product');
	}

	const db = getKnex();
	const normalizedGalleryUrls = Array.isArray(galleryUrls)
		? galleryUrls.filter((url) => typeof url === 'string' && url.trim().length > 0)
		: String(galleryUrls || '')
				.split(/\r?\n/)
				.map((url) => url.trim())
				.filter((url) => url.length > 0);

	const productId = await db.transaction(async (trx) => {
		const [inserted] = await trx('products')
			.insert({
				seller_id: sellerId,
				category_id: categoryId,
				title,
				short_description: shortDescription,
				full_description: fullDescription,
				start_price: startPrice,
				current_price: startPrice,
				step_price: stepPrice,
				buy_now_price: buyNowPrice,
				auto_extend: autoExtend,
				start_time: startDate,
				end_time: endDate,
				status,
				bid_count: 0,
				created_at: trx.fn.now(),
				updated_at: trx.fn.now(),
			})
			.returning('id');

		const newProductId = typeof inserted === 'object' && inserted !== null ? inserted.id : inserted;
		const imagesToInsert = [];

		if (imageUrl) {
			imagesToInsert.push({
				product_id: newProductId,
				image_url: imageUrl,
				alt_text: title,
				is_thumbnail: true,
				position: 1,
				created_at: trx.fn.now(),
			});
		}

		normalizedGalleryUrls.forEach((url, index) => {
			imagesToInsert.push({
				product_id: newProductId,
				image_url: url,
				alt_text: `${title} - image ${index + 1}`,
				is_thumbnail: !imageUrl && index === 0,
				position: imageUrl ? index + 2 : index + 1,
				created_at: trx.fn.now(),
			});
		});

		if (!imageUrl && imagesToInsert.length === 0) {
			imagesToInsert.push({
				product_id: newProductId,
				image_url: DEFAULT_IMAGE,
				alt_text: title,
				is_thumbnail: true,
				position: 1,
				created_at: trx.fn.now(),
			});
		}

		if (imagesToInsert.length) {
			await trx('product_images').insert(imagesToInsert);
		}

		return newProductId;
	});

	return getProductById(productId);
}

async function updateProduct(payload) {
	const {
		productId,
		sellerId,
		categoryId,
		title,
		shortDescription,
		fullDescription,
		startPrice,
		stepPrice,
		buyNowPrice = null,
		startDate,
		endDate,
		autoExtend = true,
		imageUrl = null,
		galleryUrls = [],
	} = payload;

	if (!productId || !sellerId) {
		throw new Error('Missing productId or sellerId when updating product');
	}

	const normalizedGalleryUrls = Array.isArray(galleryUrls)
		? galleryUrls.filter((url) => typeof url === 'string' && url.trim().length > 0)
		: [];

	const db = getKnex();
	await db.transaction(async (trx) => {
		const existing = await trx('products').where({ id: productId }).first();
		if (!existing || String(existing.seller_id) !== String(sellerId)) {
			throw new Error('Bạn không có quyền cập nhật sản phẩm này.');
		}

		const nextCurrentPrice = Number(existing.bid_count || 0) > 0 ? existing.current_price : startPrice;

		await trx('products')
			.where({ id: productId })
			.update({
				category_id: categoryId,
				title,
				short_description: shortDescription,
				full_description: fullDescription,
				start_price: startPrice,
				current_price: nextCurrentPrice,
				step_price: stepPrice,
				buy_now_price: buyNowPrice,
				auto_extend: autoExtend,
				start_time: startDate,
				end_time: endDate,
				updated_at: trx.fn.now(),
			});

		await trx('product_images').where({ product_id: productId }).del();

		const imagesToInsert = [];
		if (imageUrl) {
			imagesToInsert.push({
				product_id: productId,
				image_url: imageUrl,
				alt_text: title,
				is_thumbnail: true,
				position: 1,
				created_at: trx.fn.now(),
			});
		}

		normalizedGalleryUrls.forEach((url, index) => {
			imagesToInsert.push({
				product_id: productId,
				image_url: url,
				alt_text: `${title} - image ${index + 1}`,
				is_thumbnail: !imageUrl && index === 0,
				position: imageUrl ? index + 2 : index + 1,
				created_at: trx.fn.now(),
			});
		});

		if (!imageUrl && imagesToInsert.length === 0) {
			imagesToInsert.push({
				product_id: productId,
				image_url: DEFAULT_IMAGE,
				alt_text: title,
				is_thumbnail: true,
				position: 1,
				created_at: trx.fn.now(),
			});
		}

		if (imagesToInsert.length) {
			await trx('product_images').insert(imagesToInsert);
		}
	});

	return getProductById(productId);
}

async function buyProductNow({ productId, buyerId }) {
	if (!productId || !buyerId) {
		const error = new Error('Thiếu thông tin mua ngay.');
		error.code = 'BUY_NOW_INVALID_INPUT';
		throw error;
	}

	const db = getKnex();
	return db.transaction(async (trx) => {
		const product = await trx('products').where({ id: productId }).forUpdate().first();
		if (!product) {
			const error = new Error('Sản phẩm không tồn tại.');
			error.code = 'BUY_NOW_PRODUCT_NOT_FOUND';
			throw error;
		}

		if (String(product.seller_id) === String(buyerId)) {
			const error = new Error('Bạn không thể mua sản phẩm của chính mình.');
			error.code = 'BUY_NOW_SELF_PURCHASE';
			throw error;
		}

		const normalizedStatus = String(product.status || '').toLowerCase();
		if (normalizedStatus !== 'active') {
			const error = new Error('Sản phẩm này không còn mở Mua ngay.');
			error.code = 'BUY_NOW_NOT_AVAILABLE';
			throw error;
		}

		const numericPrice = Number(product.buy_now_price);
		if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
			const error = new Error('Sản phẩm chưa cấu hình giá Mua ngay.');
			error.code = 'BUY_NOW_NOT_CONFIGURED';
			throw error;
		}

		if (product.end_time && new Date(product.end_time).getTime() <= Date.now()) {
			const error = new Error('Phiên đấu giá đã kết thúc.');
			error.code = 'BUY_NOW_NOT_AVAILABLE';
			throw error;
		}

		const existingOrder = await trx('orders').where({ product_id: productId }).first();
		if (existingOrder) {
			const error = new Error('Sản phẩm đã có đơn hàng.');
			error.code = 'BUY_NOW_ALREADY_COMPLETED';
			throw error;
		}

		const nextBidCount = Number(product.bid_count || 0) + 1;

		await trx('bids').insert({
			product_id: productId,
			bidder_id: buyerId,
			bid_price: numericPrice,
			created_at: trx.fn.now(),
		});

		await trx('products')
			.where({ id: productId })
			.update({
				status: 'ended',
				current_price: numericPrice,
				bid_count: nextBidCount,
				end_time: trx.fn.now(),
				updated_at: trx.fn.now(),
			});

		const [orderRow] = await trx('orders')
			.insert({
				product_id: productId,
				seller_id: product.seller_id,
				buyer_id: buyerId,
				total_price: numericPrice,
				status: ORDER_STATUSES.AWAITING_PAYMENT_DETAILS,
				created_at: trx.fn.now(),
				updated_at: trx.fn.now(),
			})
			.returning('*');

		return {
			orderId: typeof orderRow === 'object' ? orderRow.id : orderRow,
			totalPrice: numericPrice,
		};
	});
}

async function removeProduct(productId) {
	if (!productId) return false;
	const db = getKnex();
	const result = await db('products')
		.where('id', productId)
		.update({ status: 'removed', updated_at: db.fn.now() });
	return result > 0;
}

async function restoreProduct(productId, nextStatus = 'active') {
	if (!productId) return false;
	const db = getKnex();
	const allowedStatuses = new Set(['active', 'draft']);
	const status = allowedStatuses.has(nextStatus) ? nextStatus : 'active';
	const result = await db('products')
		.where('id', productId)
		.update({ status, updated_at: db.fn.now() });
	return result > 0;
}

async function getSettings() {
	const db = getKnex();
	const rows = await db('system_settings').select('key', 'value');
	const settings = {};
	rows.forEach((row) => {
		settings[row.key] = row.value;
	});

	const autoExtendThreshold = Number(settings.auto_extend_threshold_minutes || 5);
	const autoExtendAmount = Number(settings.auto_extend_amount_minutes || 5);

	return {
		autoExtend: {
			triggerMinutes: autoExtendThreshold,
			extendMinutes: autoExtendAmount,
		},
	};
}

async function createQuestion({ productId, buyerId, questionText }) {
	if (!productId || !buyerId) {
		throw new Error('Missing productId or buyerId when creating question');
	}

	const text = (questionText || '').trim();
	if (!text) {
		throw new Error('Question text is required');
	}

	const db = getKnex();
	const [inserted] = await db('questions')
		.insert({
			product_id: productId,
			buyer_id: buyerId,
			question_text: text,
			created_at: db.fn.now(),
		})
		.returning('id');

	return typeof inserted === 'object' ? inserted.id : inserted;
}

async function createAnswer({ questionId, sellerId, answerText }) {
	if (!questionId || !sellerId) {
		throw new Error('Missing questionId or sellerId when creating answer');
	}

	const text = (answerText || '').trim();
	if (!text) {
		throw new Error('Answer text is required');
	}

	const db = getKnex();
	const [inserted] = await db('answers')
		.insert({
			question_id: questionId,
			seller_id: sellerId,
			answer_text: text,
			created_at: db.fn.now(),
		})
		.returning('id');

	return typeof inserted === 'object' ? inserted.id : inserted;
}

async function getQuestionById(questionId) {
	if (!questionId) return null;
	const db = getKnex();
	const row = await db('questions').where('id', questionId).first();
	if (!row) return null;
	return {
		id: row.id,
		productId: row.product_id,
		buyerId: row.buyer_id,
		text: row.question_text,
		createdAt: row.created_at,
	};
}

module.exports = {
	DEFAULT_IMAGE,
	ensureCategoryCache,
	resetCategoryCache,
	buildCategoryPath,
	baseProductQuery,
	applyActiveSellerFilter,
	applyProductSort,
	hydrateProducts,
	getCategories,
	getCategoryById,
	getProducts,
	getProductsEndingSoon,
	getProductsMostBids,
	getProductsHighestPrice,
	getProductsByCategory,
	getProductsBySeller,
	getProductsByBidder,
	getProductsWonByBidder,
	getRelatedProducts,
	searchProducts,
	getProductById,
	createProduct,
	updateProduct,
	buyProductNow,
	removeProduct,
	restoreProduct,
	getSettings,
	createQuestion,
	createAnswer,
	getQuestionById,
};
