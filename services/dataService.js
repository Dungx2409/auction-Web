const { getKnex } = require('../db/knex');
const userStore = require('./userStore');

const DEFAULT_IMAGE = 'https://images.unsplash.com/photo-1515165562835-c4c42b6b8663?auto=format&fit=crop&w=800&q=80';

let categoryTreeCache = null;
let categoryMapCache = null;

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
  return getProducts({ status: 'active', limit, sort: 'endingSoon' });
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

  const qaRows = await db('questions as q')
    .leftJoin('answers as a', 'a.question_id', 'q.id')
    .leftJoin('users as buyer', 'buyer.id', 'q.buyer_id')
    .where('q.product_id', id)
    .orderBy('q.created_at', 'desc')
    .select(
      'q.id',
      'q.question_text',
      'q.created_at',
      'buyer.full_name as buyer_name',
      'a.answer_text',
      'a.created_at as answered_at'
    );

  product.questions = qaRows.map((qa) => ({
    id: qa.id,
    question: qa.question_text,
    askedBy: qa.buyer_name || 'Khách hàng',
    askedAt: qa.created_at,
    answer: qa.answer_text || 'Người bán sẽ trả lời sớm nhất.',
    answeredAt: qa.answered_at || qa.created_at,
  }));

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
  endDate,
  autoExtend = true,
  status = 'active',
  imageUrl = null,
}) {
  if (!sellerId) {
    throw new Error('Missing sellerId when creating product');
  }

  const db = getKnex();
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

    if (imageUrl) {
      await trx('product_images').insert({
        product_id: inserted.id,
        image_url: imageUrl,
        position: 1,
      });
    }

    return inserted.id;
  });

  return getProductById(productId);
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
    product,
  }));
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

function resetCache() {
  categoryTreeCache = null;
  categoryMapCache = null;
}

module.exports = {
  resetCache,
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
  getSettings,
  getUsers,
  getUserById,
  getUserByEmail,
  createProduct,
  removeProduct,
  restoreProduct,
  getProductsByBidder,
};
