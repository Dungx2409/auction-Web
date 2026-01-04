const express = require('express');
const router = express.Router();
const dataService = require('../services/dataService');

// GET /users/:id/ratings - Xem đánh giá của một user
router.get('/:id/ratings', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!userId || isNaN(userId)) {
      return res.status(400).render('404', { title: 'Người dùng không hợp lệ' });
    }

    // Lấy thông tin user
    const user = await dataService.getUserById(userId);
    if (!user) {
      return res.status(404).render('404', { title: 'Không tìm thấy người dùng' });
    }

    // Lấy danh sách đánh giá
    const ratings = await dataService.getRatingsReceivedByUser(userId, { limit: 50 });
    
    // Tính tỷ lệ đánh giá
    const ratingPlus = Number(user.ratingPlus || 0);
    const ratingMinus = Number(user.ratingMinus || 0);
    const ratingTotal = ratingPlus + ratingMinus;
    const ratingPercent = ratingTotal > 0 ? Math.round((ratingPlus / ratingTotal) * 100) : null;

    // Xác định role của user
    const userRole = user.role || 'bidder';
    const isSeller = userRole === 'seller' || userRole === 'admin';
    const isBidder = userRole === 'bidder' || userRole === 'seller' || userRole === 'admin';

    res.render('users/ratings', {
      title: `Đánh giá của ${user.fullName}`,
      profileUser: {
        id: user.id,
        name: user.fullName,
        role: userRole,
        isSeller,
        isBidder,
        ratingPlus,
        ratingMinus,
        ratingTotal,
        ratingPercent,
        createdAt: user.createdAt,
      },
      ratings: ratings.map(r => ({
        id: r.id,
        score: r.score,
        comment: r.comment,
        createdAt: r.createdAt,
        fromUser: {
          id: r.fromUserId,
          name: r.fromUserName || 'Ẩn danh',
        },
        product: r.productId ? {
          id: r.productId,
          title: r.productTitle || 'Sản phẩm',
        } : null,
      })),
      hasRatings: ratings.length > 0,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
