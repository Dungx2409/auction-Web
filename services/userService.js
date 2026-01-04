const { getKnex, mapUserRow } = require('./shared/dbUtils');

async function getUsers() {
	const db = getKnex();
	const rows = await db('users').select(
		'id',
		'full_name',
		'email',
		'password_hash',
		'address',
		'date_of_birth',
		'role',
		'rating_pos',
		'rating_neg',
		'status',
		'created_at',
		'updated_at'
	);
	return rows.map(mapUserRow);
}

async function getUserById(id) {
	if (!id) return null;
	const db = getKnex();
	const row = await db('users').where({ id }).first();
	return mapUserRow(row);
}

async function getUserByEmail(email) {
	if (!email) return null;
	const normalized = String(email).toLowerCase();
	const db = getKnex();
	const row = await db('users').whereRaw('LOWER(email) = ?', [normalized]).first();
	return mapUserRow(row);
}

async function getRatingsReceivedByUser(userId, options = {}) {
	if (!userId) return [];
	const limit = Math.max(Number(options.limit) || 10, 1);
	const db = getKnex();
	const rows = await db('ratings as r')
		.leftJoin('users as reviewer', 'reviewer.id', 'r.from_user_id')
		.leftJoin('products as p', 'p.id', 'r.product_id')
		.select(
			'r.id',
			'r.score',
			'r.comment',
			'r.created_at',
			'r.product_id',
			'r.from_user_id',
			'reviewer.full_name as reviewer_name',
			'reviewer.rating_pos as reviewer_rating_pos',
			'reviewer.rating_neg as reviewer_rating_neg',
			'p.title as product_title'
		)
		.where('r.to_user_id', userId)
		.orderBy('r.created_at', 'desc')
		.limit(limit);

	return rows.map((row) => ({
		id: row.id,
		score: Number(row.score || 0),
		comment: row.comment || '',
		createdAt: row.created_at,
		product: row.product_id
			? {
				id: row.product_id,
				title: row.product_title || `Sản phẩm #${row.product_id}`,
			}
			: null,
		reviewer: row.from_user_id
			? {
				id: row.from_user_id,
				name: row.reviewer_name || `Người dùng #${row.from_user_id}`,
				ratingPlus: Number(row.reviewer_rating_pos || 0),
				ratingMinus: Number(row.reviewer_rating_neg || 0),
			}
			: null,
	}));
}

async function updateUserPassword(userId, newPasswordHash) {
	if (!userId || !newPasswordHash) return false;
	const db = getKnex();
	const updated = await db('users')
		.where({ id: userId })
		.update({ 
			password_hash: newPasswordHash,
			updated_at: db.fn.now()
		});
	return updated > 0;
}

module.exports = {
	getUsers,
	getUserById,
	getUserByEmail,
	getRatingsReceivedByUser,
	updateUserPassword,
};
