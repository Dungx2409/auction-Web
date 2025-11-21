const crypto = require('crypto');

const REGISTRATION_LIFETIME_MS = 10 * 60 * 1000; // 10 minutes

const pending = new Map();

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function createPendingRegistration(payload) {
  const id = crypto.randomUUID();
  const otp = generateOtp();
  const expiresAt = Date.now() + REGISTRATION_LIFETIME_MS;

  pending.set(id, {
    id,
    otp,
    expiresAt,
    payload,
  });

  return {
    id,
    otp,
    expiresAt,
  };
}

function getRegistration(id) {
  if (!id) return null;
  const item = pending.get(id);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    pending.delete(id);
    return null;
  }
  return item;
}

function verifyOtp(id, otp) {
  const item = getRegistration(id);
  if (!item) return { success: false, error: 'Mã xác minh đã hết hạn hoặc không tồn tại.' };
  if (item.otp !== otp) {
    return { success: false, error: 'OTP không chính xác.' };
  }
  pending.delete(id);
  return { success: true, payload: item.payload };
}

module.exports = {
  createPendingRegistration,
  getRegistration,
  verifyOtp,
};
