const productService = require('./productService');
const bidService = require('./bidService');
const orderService = require('./orderService');
const userService = require('./userService');
const upgradeService = require('./upgradeService');
const categoryService = require('./categoryService');

// Connect categoryService to productService's cache reset function
categoryService.setResetCategoryCache(productService.resetCategoryCache);

module.exports = {
  ...productService,
  ...bidService,
  ...orderService,
  ...userService,
  ...upgradeService,
  ...categoryService,
};
