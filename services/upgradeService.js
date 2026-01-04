const { getKnex, mapUserRow } = require('./shared/dbUtils');

/**
 * Get the latest upgrade request for a user
 * @param {number} userId 
 * @returns {Promise<Object|null>}
 */
async function getUpgradeRequestByUser(userId) {
  if (!userId) return null;
  const db = getKnex();
  const row = await db('user_upgrade_requests')
    .where({ user_id: userId })
    .orderBy('request_date', 'desc')
    .first();

  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    requestDate: row.request_date,
    status: row.status,
    adminNote: row.admin_note,
    notificationSeen: row.notification_seen ?? false,
  };
}

/**
 * Get all pending upgrade requests
 * @returns {Promise<Array>}
 */
async function getPendingUpgradeRequests() {
  const db = getKnex();
  const rows = await db('user_upgrade_requests as ur')
    .leftJoin('users as u', 'u.id', 'ur.user_id')
    .select(
      'ur.id',
      'ur.user_id',
      'ur.request_date',
      'ur.status',
      'ur.admin_note',
      'u.full_name',
      'u.email',
      'u.rating_pos',
      'u.rating_neg',
      'u.created_at as user_created_at'
    )
    .where('ur.status', 'pending')
    .orderBy('ur.request_date', 'asc');

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    requestDate: row.request_date,
    status: row.status,
    adminNote: row.admin_note,
    user: {
      id: row.user_id,
      name: row.full_name || `Người dùng #${row.user_id}`,
      email: row.email,
      ratingPlus: Number(row.rating_pos || 0),
      ratingMinus: Number(row.rating_neg || 0),
      createdAt: row.user_created_at,
    },
  }));
}

/**
 * Get all upgrade requests with pagination
 * @param {Object} options
 * @returns {Promise<Array>}
 */
async function getAllUpgradeRequests(options = {}) {
  const { status, limit = 50 } = options;
  const db = getKnex();
  let query = db('user_upgrade_requests as ur')
    .leftJoin('users as u', 'u.id', 'ur.user_id')
    .select(
      'ur.id',
      'ur.user_id',
      'ur.request_date',
      'ur.status',
      'ur.admin_note',
      'u.full_name',
      'u.email',
      'u.rating_pos',
      'u.rating_neg',
      'u.created_at as user_created_at'
    )
    .orderBy('ur.request_date', 'desc')
    .limit(limit);

  if (status) {
    query = query.where('ur.status', status);
  }

  const rows = await query;

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    requestDate: row.request_date,
    status: row.status,
    adminNote: row.admin_note,
    user: {
      id: row.user_id,
      name: row.full_name || `Người dùng #${row.user_id}`,
      email: row.email,
      ratingPlus: Number(row.rating_pos || 0),
      ratingMinus: Number(row.rating_neg || 0),
      createdAt: row.user_created_at,
    },
  }));
}

/**
 * Create a new upgrade request
 * @param {number} userId 
 * @returns {Promise<Object>}
 */
async function createUpgradeRequest(userId) {
  if (!userId) {
    throw new Error('User ID is required');
  }

  const db = getKnex();

  // Check if user exists and is a bidder
  const user = await db('users').where({ id: userId }).first();
  if (!user) {
    throw new Error('Người dùng không tồn tại');
  }

  if (user.role !== 'bidder') {
    throw new Error('Chỉ tài khoản bidder mới có thể yêu cầu nâng cấp');
  }

  // Check if there's already a pending request
  const existingRequest = await db('user_upgrade_requests')
    .where({ user_id: userId, status: 'pending' })
    .first();

  if (existingRequest) {
    throw new Error('Bạn đã có một yêu cầu đang chờ duyệt');
  }

  const [inserted] = await db('user_upgrade_requests')
    .insert({
      user_id: userId,
      status: 'pending',
    })
    .returning('*');

  return {
    id: inserted.id,
    userId: inserted.user_id,
    requestDate: inserted.request_date,
    status: inserted.status,
    adminNote: inserted.admin_note,
  };
}

/**
 * Approve an upgrade request
 * @param {number} requestId 
 * @param {string} adminNote 
 * @returns {Promise<Object>}
 */
async function approveUpgradeRequest(requestId, adminNote = '') {
  if (!requestId) {
    throw new Error('Request ID is required');
  }

  const db = getKnex();

  // Get the request
  const request = await db('user_upgrade_requests').where({ id: requestId }).first();
  if (!request) {
    throw new Error('Yêu cầu không tồn tại');
  }

  if (request.status !== 'pending') {
    throw new Error('Yêu cầu đã được xử lý');
  }

  // Start transaction
  const trx = await db.transaction();

  try {
    // Update request status
    await trx('user_upgrade_requests')
      .where({ id: requestId })
      .update({
        status: 'approved',
        admin_note: adminNote || null,
      });

    // Update user role to seller
    await trx('users')
      .where({ id: request.user_id })
      .update({
        role: 'seller',
        updated_at: trx.fn.now(),
      });

    await trx.commit();

    // Get updated request
    const updatedRequest = await db('user_upgrade_requests').where({ id: requestId }).first();

    return {
      id: updatedRequest.id,
      userId: updatedRequest.user_id,
      requestDate: updatedRequest.request_date,
      status: updatedRequest.status,
      adminNote: updatedRequest.admin_note,
    };
  } catch (error) {
    await trx.rollback();
    throw error;
  }
}

/**
 * Reject an upgrade request
 * @param {number} requestId 
 * @param {string} adminNote 
 * @returns {Promise<Object>}
 */
async function rejectUpgradeRequest(requestId, adminNote = '') {
  if (!requestId) {
    throw new Error('Request ID is required');
  }

  const db = getKnex();

  // Get the request
  const request = await db('user_upgrade_requests').where({ id: requestId }).first();
  if (!request) {
    throw new Error('Yêu cầu không tồn tại');
  }

  if (request.status !== 'pending') {
    throw new Error('Yêu cầu đã được xử lý');
  }

  // Update request status
  await db('user_upgrade_requests')
    .where({ id: requestId })
    .update({
      status: 'rejected',
      admin_note: adminNote || null,
    });

  // Get updated request
  const updatedRequest = await db('user_upgrade_requests').where({ id: requestId }).first();

  return {
    id: updatedRequest.id,
    userId: updatedRequest.user_id,
    requestDate: updatedRequest.request_date,
    status: updatedRequest.status,
    adminNote: updatedRequest.admin_note,
  };
}

/**
 * Get upgrade request counts
 * @returns {Promise<Object>}
 */
async function getUpgradeRequestCounts() {
  const db = getKnex();
  const rows = await db('user_upgrade_requests')
    .select('status')
    .count('id as count')
    .groupBy('status');

  const counts = {
    pending: 0,
    approved: 0,
    rejected: 0,
    total: 0,
  };

  rows.forEach((row) => {
    const status = String(row.status).toLowerCase();
    const count = Number(row.count || 0);
    if (counts.hasOwnProperty(status)) {
      counts[status] = count;
    }
    counts.total += count;
  });

  return counts;
}

/**
 * Check if user has unseen upgrade approval notification
 * @param {number} userId 
 * @returns {Promise<boolean>}
 */
async function hasUnseenUpgradeNotification(userId) {
  if (!userId) return false;
  const db = getKnex();
  const row = await db('user_upgrade_requests')
    .where({ user_id: userId, status: 'approved', notification_seen: false })
    .first();
  return Boolean(row);
}

/**
 * Mark upgrade notification as seen
 * @param {number} userId 
 * @returns {Promise<boolean>}
 */
async function markUpgradeNotificationSeen(userId) {
  if (!userId) return false;
  const db = getKnex();
  const updated = await db('user_upgrade_requests')
    .where({ user_id: userId, status: 'approved', notification_seen: false })
    .update({ notification_seen: true });
  return updated > 0;
}

module.exports = {
  getUpgradeRequestByUser,
  getPendingUpgradeRequests,
  getAllUpgradeRequests,
  createUpgradeRequest,
  approveUpgradeRequest,
  rejectUpgradeRequest,
  getUpgradeRequestCounts,
  hasUnseenUpgradeNotification,
  markUpgradeNotificationSeen,
};
