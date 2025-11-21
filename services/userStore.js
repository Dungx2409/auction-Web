const { getKnex } = require('../db/knex');

function mapDbUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    role: row.role,
    name: row.full_name || row.name,
    address: row.address,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ratingPlus: row.rating_pos ?? row.rating_plus ?? 0,
    ratingMinus: row.rating_neg ?? row.rating_minus ?? 0,
    status: row.status,
    dateOfBirth: row.date_of_birth,
    watchlist: [],
    activeBids: [],
    wins: [],
  };
}

async function getAllUsers() {
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
  return rows.map(mapDbUser);
}

async function findByEmail(email) {
  if (!email) return null;
  const normalized = email.toLowerCase();
  const db = getKnex();
  const row = await db('users').whereRaw('LOWER(email) = ?', [normalized]).first();
  return mapDbUser(row);
}

async function findById(id) {
  if (!id) return null;
  const db = getKnex();
  const row = await db('users').where({ id }).first();
  return mapDbUser(row);
}

async function createUser({ name, address, email, passwordHash, role = 'bidder' }) {
  const db = getKnex();
  const payload = {
    full_name: name,
    email,
    password_hash: passwordHash,
    address,
    role,
  };
  const [inserted] = await db('users').insert(payload).returning('*');
  return mapDbUser(inserted);
}

async function updateUser(userId, updates = {}) {
  if (!userId) return null;
  const db = getKnex();
  const payload = {
    ...updates,
    updated_at: db.fn.now(),
  };
  if (payload.passwordHash) {
    payload.password_hash = payload.passwordHash;
    delete payload.passwordHash;
  }
  if (payload.name) {
    payload.full_name = payload.name;
    delete payload.name;
  }
  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) {
      delete payload[key];
    }
  });
  const [updated] = await db('users').where({ id: userId }).update(payload).returning('*');
  return mapDbUser(updated);
}

module.exports = {
  getAllUsers,
  findByEmail,
  findById,
  createUser,
  updateUser,
};
