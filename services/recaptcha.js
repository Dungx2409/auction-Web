const config = require('../config');

async function verifyRecaptcha(token, remoteIp) {
  if (!token) {
    return {
      success: false,
      error: 'Thiếu mã reCAPTCHA.',
    };
  }

  if (!config.recaptchaSecret) {
    const success = token === 'test-pass';
    return success
      ? { success: true, mode: 'development' }
      : {
          success: false,
          error: 'reCAPTCHA không hợp lệ (dev mode).',
        };
  }

  const params = new URLSearchParams();
  params.append('secret', config.recaptchaSecret);
  params.append('response', token);
  if (remoteIp) {
    params.append('remoteip', remoteIp);
  }

  const fetchImpl = typeof fetch === 'function' ? fetch : (await import('node-fetch')).default;

  const response = await fetchImpl('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!response.ok) {
    return {
      success: false,
      error: `Không thể xác thực reCAPTCHA (HTTP ${response.status})`,
    };
  }

  const payload = await response.json();
  if (payload.success) {
    return {
      success: true,
      score: payload.score,
      action: payload.action,
    };
  }

  return {
    success: false,
    error: payload['error-codes']?.join(', ') || 'Xác thực reCAPTCHA thất bại.',
  };
}

module.exports = {
  verifyRecaptcha,
};
