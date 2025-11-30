function toStringId(value) {
  if (value == null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

function buildWatchSet(ids) {
  if (!ids || !ids.length) return null;
  return new Set(ids.map((value) => toStringId(value)).filter(Boolean));
}

function applyWatchStateToProduct(product, watchSet) {
  if (!product || !product.id) return product;
  if (!watchSet) {
    product.isWatching = Boolean(product.isWatching);
    return product;
  }
  product.isWatching = watchSet.has(toStringId(product.id));
  return product;
}

function applyWatchStateToList(products, watchSet) {
  if (!Array.isArray(products) || !products.length) return products;
  products.forEach((product) => applyWatchStateToProduct(product, watchSet));
  return products;
}

module.exports = {
  buildWatchSet,
  applyWatchStateToProduct,
  applyWatchStateToList,
};
