const { getKnex, toNumber } = require('./shared/dbUtils');

// Import resetCategoryCache from productService to invalidate cache on changes
let resetCategoryCache = null;

function setResetCategoryCache(fn) {
  resetCategoryCache = fn;
}

/**
 * Get all categories as flat list
 */
async function getAllCategoriesFlat() {
  const db = getKnex();
  const rows = await db('categories')
    .select('id', 'name', 'parent_id', 'description', 'created_at')
    .orderBy('parent_id', 'asc')
    .orderBy('name', 'asc');

  return rows.map((row) => ({
    id: String(row.id),
    name: row.name,
    parentId: row.parent_id != null ? String(row.parent_id) : null,
    description: row.description || '',
    createdAt: row.created_at,
  }));
}

/**
 * Get parent categories (categories without parent_id)
 */
async function getParentCategories() {
  const db = getKnex();
  const rows = await db('categories')
    .select('id', 'name', 'description', 'created_at')
    .whereNull('parent_id')
    .orderBy('name', 'asc');

  return rows.map((row) => ({
    id: String(row.id),
    name: row.name,
    description: row.description || '',
    createdAt: row.created_at,
  }));
}

/**
 * Get category by ID with children
 */
async function getCategoryWithChildren(id) {
  if (!id) return null;
  const db = getKnex();

  const category = await db('categories')
    .select('id', 'name', 'parent_id', 'description', 'created_at')
    .where('id', id)
    .first();

  if (!category) return null;

  const children = await db('categories')
    .select('id', 'name', 'description', 'created_at')
    .where('parent_id', id)
    .orderBy('name', 'asc');

  return {
    id: String(category.id),
    name: category.name,
    parentId: category.parent_id != null ? String(category.parent_id) : null,
    description: category.description || '',
    createdAt: category.created_at,
    children: children.map((child) => ({
      id: String(child.id),
      name: child.name,
      description: child.description || '',
      createdAt: child.created_at,
    })),
  };
}

/**
 * Create a new category
 */
async function createCategory({ name, parentId = null, description = '' }) {
  if (!name || !name.trim()) {
    throw new Error('Tên danh mục không được để trống.');
  }

  const db = getKnex();

  // If parentId is provided, verify it exists and is a parent category (no parent_id itself)
  if (parentId) {
    const parent = await db('categories')
      .select('id', 'parent_id')
      .where('id', parentId)
      .first();

    if (!parent) {
      throw new Error('Danh mục cha không tồn tại.');
    }

    // Only allow 2 levels: if parent already has a parent, reject
    if (parent.parent_id != null) {
      throw new Error('Chỉ hỗ trợ danh mục 2 cấp. Không thể tạo danh mục con của danh mục con.');
    }
  }

  // Check for duplicate name at the same level
  const existsQuery = db('categories').where('name', name.trim());
  if (parentId) {
    existsQuery.andWhere('parent_id', parentId);
  } else {
    existsQuery.whereNull('parent_id');
  }
  const existing = await existsQuery.first();

  if (existing) {
    throw new Error('Danh mục với tên này đã tồn tại ở cùng cấp.');
  }

  const [inserted] = await db('categories')
    .insert({
      name: name.trim(),
      parent_id: parentId || null,
      description: description.trim() || null,
    })
    .returning(['id', 'name', 'parent_id', 'description', 'created_at']);

  // Reset category cache
  if (resetCategoryCache) {
    resetCategoryCache();
  }

  return {
    id: String(inserted.id),
    name: inserted.name,
    parentId: inserted.parent_id != null ? String(inserted.parent_id) : null,
    description: inserted.description || '',
    createdAt: inserted.created_at,
  };
}

/**
 * Update an existing category
 */
async function updateCategory(id, { name, parentId, description }) {
  if (!id) {
    throw new Error('ID danh mục không hợp lệ.');
  }

  const db = getKnex();

  // Check if category exists
  const category = await db('categories')
    .select('id', 'parent_id')
    .where('id', id)
    .first();

  if (!category) {
    throw new Error('Danh mục không tồn tại.');
  }

  const updates = {};

  if (name !== undefined) {
    if (!name || !name.trim()) {
      throw new Error('Tên danh mục không được để trống.');
    }

    // Check for duplicate name at the same level (excluding current category)
    const targetParentId = parentId !== undefined ? parentId : category.parent_id;
    const existsQuery = db('categories')
      .where('name', name.trim())
      .whereNot('id', id);

    if (targetParentId) {
      existsQuery.andWhere('parent_id', targetParentId);
    } else {
      existsQuery.whereNull('parent_id');
    }

    const existing = await existsQuery.first();
    if (existing) {
      throw new Error('Danh mục với tên này đã tồn tại ở cùng cấp.');
    }

    updates.name = name.trim();
  }

  if (parentId !== undefined) {
    // Cannot set parent_id to itself
    if (String(parentId) === String(id)) {
      throw new Error('Không thể đặt danh mục làm cha của chính nó.');
    }

    // If setting a parent, verify it exists and is a root category
    if (parentId) {
      const parent = await db('categories')
        .select('id', 'parent_id')
        .where('id', parentId)
        .first();

      if (!parent) {
        throw new Error('Danh mục cha không tồn tại.');
      }

      if (parent.parent_id != null) {
        throw new Error('Chỉ hỗ trợ danh mục 2 cấp. Không thể di chuyển vào danh mục con.');
      }

      // Check if current category has children - cannot become a child if it has children
      const hasChildren = await db('categories')
        .where('parent_id', id)
        .first();

      if (hasChildren) {
        throw new Error('Danh mục này có danh mục con. Không thể di chuyển thành danh mục cấp 2.');
      }
    }

    updates.parent_id = parentId || null;
  }

  if (description !== undefined) {
    updates.description = description.trim() || null;
  }

  if (Object.keys(updates).length === 0) {
    return getCategoryWithChildren(id);
  }

  await db('categories').where('id', id).update(updates);

  // Reset category cache
  if (resetCategoryCache) {
    resetCategoryCache();
  }

  return getCategoryWithChildren(id);
}

/**
 * Delete a category
 * Will fail if category has children or products
 */
async function deleteCategory(id) {
  if (!id) {
    throw new Error('ID danh mục không hợp lệ.');
  }

  const db = getKnex();

  // Check if category exists
  const category = await db('categories')
    .select('id', 'name')
    .where('id', id)
    .first();

  if (!category) {
    throw new Error('Danh mục không tồn tại.');
  }

  // Check for child categories
  const childCount = await db('categories')
    .where('parent_id', id)
    .count('id as count')
    .first();

  if (parseInt(childCount.count, 10) > 0) {
    throw new Error('Không thể xóa danh mục có danh mục con. Vui lòng xóa các danh mục con trước.');
  }

  // Check for products in this category
  const productCount = await db('products')
    .where('category_id', id)
    .count('id as count')
    .first();

  if (parseInt(productCount.count, 10) > 0) {
    throw new Error('Không thể xóa danh mục có sản phẩm. Vui lòng di chuyển hoặc xóa các sản phẩm trước.');
  }

  await db('categories').where('id', id).delete();

  // Reset category cache
  if (resetCategoryCache) {
    resetCategoryCache();
  }

  return { success: true, deletedId: String(id), deletedName: category.name };
}

/**
 * Get category stats (product count per category)
 */
async function getCategoryStats() {
  const db = getKnex();

  const stats = await db('categories as c')
    .leftJoin('products as p', 'p.category_id', 'c.id')
    .select('c.id')
    .count('p.id as productCount')
    .groupBy('c.id');

  const map = new Map();
  stats.forEach((row) => {
    map.set(String(row.id), parseInt(row.productCount, 10) || 0);
  });

  return map;
}

/**
 * Get categories tree with product counts for admin
 */
async function getCategoriesForAdmin() {
  const [categories, statsMap] = await Promise.all([
    getAllCategoriesFlat(),
    getCategoryStats(),
  ]);

  // Build tree structure
  const map = new Map();
  categories.forEach((cat) => {
    map.set(cat.id, {
      ...cat,
      productCount: statsMap.get(cat.id) || 0,
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

  // Calculate total product count for parent categories (including children)
  roots.forEach((root) => {
    const childProductCount = root.children.reduce((sum, child) => sum + child.productCount, 0);
    root.totalProductCount = root.productCount + childProductCount;
  });

  return roots;
}

module.exports = {
  setResetCategoryCache,
  getAllCategoriesFlat,
  getParentCategories,
  getCategoryWithChildren,
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryStats,
  getCategoriesForAdmin,
};
