const { getKnex } = require('../db/knex');
const userStore = require('./userStore');

const DEFAULT_IMAGE = 'https://images.unsplash.com/photo-1515165562835-c4c42b6b8663?auto=format&fit=crop&w=800&q=80';

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
	[ORDER_STATUSES.PAYMENT_CONFIRMED_AWAITING_DELIVERY]: 'Người bán đang gửi hàng',
	[ORDER_STATUSES.DELIVERY_CONFIRMED_READY_TO_RATE]: 'Chờ đánh giá',
	[ORDER_STATUSES.TRANSACTION_COMPLETED]: 'Giao dịch hoàn tất',
	[ORDER_STATUSES.CANCELED_BY_SELLER]: 'Đã huỷ bởi người bán',
};

function translateOrderStatus(status) {
	return ORDER_STATUS_LABELS[status] || 'Không xác định';
}

const ORDER_CANCELABLE_STATUSES = new Set([
  ORDER_STATUSES.AWAITING_PAYMENT_DETAILS,
  ORDER_STATUSES.PAYMENT_CONFIRMED_AWAITING_DELIVERY,
  ORDER_STATUSES.DELIVERY_CONFIRMED_READY_TO_RATE,
]);

const DEFAULT_CHAT_HISTORY_LIMIT = 50;

let categoryTreeCache = null;
let categoryMapCache = null;
let orderStatusEnumEnsured = false;
let orderWorkflowSchemaEnsured = false;

function toNumber(value) {
  if (value == null) return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

async function ensureCategoryCache() {
  if (categoryTreeCache && categoryMapCache) {
    return;
  }
  const db = getKnex();
  const rows = await db('categories').select('id', 'name', 'parent_id', 'description').orderBy('parent_id', 'asc').orderBy('name', 'asc');

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

async function ensureOrderWorkflowSchema() {
  if (orderWorkflowSchemaEnsured) return;
  const db = getKnex();
  const statements = [
    'ALTER TABLE IF EXISTS order_invoices ADD COLUMN IF NOT EXISTS payment_method TEXT',
    'ALTER TABLE IF EXISTS order_invoices ADD COLUMN IF NOT EXISTS note TEXT',
    'ALTER TABLE IF EXISTS order_shipments ADD COLUMN IF NOT EXISTS carrier TEXT',
    'ALTER TABLE IF EXISTS order_shipments ADD COLUMN IF NOT EXISTS invoice_url TEXT',
  ];
  for (const statement of statements) {
    await db.raw(statement);
  }
  orderWorkflowSchemaEnsured = true;
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
      's.rating_pos as seller_rating_pos',
      's.rating_neg as seller_rating_neg',
      's.status as seller_status'
    );
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
    .select('b.product_id', 'b.bid_price', 'b.bidder_id', 'u.full_name as bidder_name', 'u.rating_pos', 'u.rating_neg')
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
  return hydrateProducts(rows);
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
  return hydrateProducts(rows);
}

async function getProductsHighestPrice(limit = 5) {
  const db = getKnex();
  const query = baseProductQuery(db)
    .where('p.status', 'active')
    .orderBy('p.current_price', 'desc')
    .orderBy('p.end_time', 'asc')
    .limit(limit);
  applyActiveSellerFilter(query);
  const rows = await query;
  return hydrateProducts(rows);
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
  return hydrateProducts(rows);
}

async function getProductsBySeller(sellerId, { status } = {}) {
  if (!sellerId) return [];
  const db = getKnex();
  const query = baseProductQuery(db)
    .where('p.seller_id', sellerId)
    .orderBy('p.created_at', 'desc');

  if (Array.isArray(status) && status.length) {
    query.whereIn('p.status', status);
  } else if (status) {
    query.andWhere('p.status', status);
  }

  const rows = await query;
  return hydrateProducts(rows);
}

async function getProductsByBidder(bidderId) {
  if (!bidderId) return [];
  const db = getKnex();

  // Find distinct product IDs the bidder has placed bids on, ordered by latest bid time
  const rows = await db('bids as b')
    .select('b.product_id')
    .where('b.bidder_id', bidderId)
    .groupBy('b.product_id')
    .orderByRaw('MAX(b.created_at) DESC');

  const productIds = rows.map((r) => r.product_id);
  if (!productIds.length) return [];

  const productsRows = await baseProductQuery(db).whereIn('p.id', productIds).orderBy('p.end_time', 'asc');
  return hydrateProducts(productsRows);
}

async function searchProducts(query, { sort = 'endingSoon', categoryId } = {}) {
  const db = getKnex();
  const builder = baseProductQuery(db).where('p.status', 'active');
  applyActiveSellerFilter(builder);

  if (query) {
    builder.andWhere((qb) => {
      qb.whereILike('p.title', `%${query}%`).orWhereILike('p.short_description', `%${query}%`);
    });
  }

  if (categoryId) {
    builder.andWhere('p.category_id', categoryId);
  }

  applyProductSort(builder, sort);
  builder.limit(60);

  const rows = await builder;
  return hydrateProducts(rows);
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
    .select('b.id', 'b.bid_price', 'b.created_at', 'u.full_name', 'u.rating_pos', 'u.rating_neg');

  product.bids = bids.map((bid) => ({
    id: bid.id,
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
      .select(
        'a.id',
        'a.question_id',
        'a.answer_text',
        'a.created_at',
        'seller.full_name as seller_name',
        'seller.id as seller_id'
      );

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

async function createProduct({
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
  imageFile = null,
  endDate,
  autoExtend = true,
  status = 'active',
  imageUrl = null,
}) {
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

async function updateProduct({
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
}) {
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

async function getUsers() {
  return userStore.getAllUsers();
}

async function getUserById(id) {
  if (!id) return null;
  return userStore.findById(id);
}

async function getUserByEmail(email) {
  if (!email) return null;
  return userStore.findByEmail(email);
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
  return {
    id: row.id,
    billingAddress: row.billing_address,
    shippingAddress: row.shipping_address,
    paymentMethod: row.payment_method,
    paymentProof: row.payment_proof,
    note: row.note,
    createdAt: row.created_at,
  };
}

async function getOrderShipment(orderId, trx) {
  if (!orderId) return null;
  const executor = trx || getKnex();
  const row = await executor('order_shipments').where({ order_id: orderId }).orderBy('created_at', 'desc').first();
  if (!row) return null;
  return {
    id: row.id,
    carrier: row.carrier,
    trackingNumber: row.tracking_number,
    invoiceUrl: row.invoice_url,
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
      description:
        'Người thắng đấu giá cung cấp địa chỉ giao nhận và phương thức thanh toán để người bán kiểm chứng.',
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

function resetCache() {
  categoryTreeCache = null;
  categoryMapCache = null;
}

module.exports = {
  resetCache,
  ORDER_STATUSES,
  ORDER_STATUS_FLOW,
  getOrderWorkflowMetadata,
  getCategories,
  getCategoryById,
  getProducts,
  getProductsByCategory,
  getProductsBySeller,
  getProductsEndingSoon,
  getProductsMostBids,
  getProductsHighestPrice,
  getProductById,
  getRelatedProducts,
  searchProducts,
  getWatchlistForUser,
  getWatchlistProductIds,
  addToWatchlist,
  removeFromWatchlist,
  countWatchersForProduct,
  placeBid,
  getSettings,
  getUsers,
  getUserById,
  getUserByEmail,
  createProduct,
  updateProduct,
  removeProduct,
  restoreProduct,
  getProductsByBidder,
  createQuestion,
  createAnswer,
  getQuestionById,
  getOrderById,
  getOrderByProductId,
  ensureOrderForProduct,
  submitOrderPaymentDetails,
  sellerConfirmPaymentAndShipment,
  buyerConfirmDelivery,
  cancelOrderBySeller,
  listOrderMessages,
  appendOrderMessage,
  upsertOrderRating,
  canSellerCancelOrder,
  ORDER_STATUS_LABELS,
  translateOrderStatus,
};
