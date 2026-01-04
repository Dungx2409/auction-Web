const { getKnex } = require('../../db/knex');

function toNumber(value) {
  if (value == null) return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

function mapUserRow(row) {
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

module.exports = {
  getKnex,
  toNumber,
  mapUserRow,
};
