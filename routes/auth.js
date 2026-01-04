const express = require('express');
const bcrypt = require('bcryptjs');

const dataService = require('../services/dataService');
const userStore = require('../services/userStore');
const { verifyRecaptcha } = require('../services/recaptcha');
const pendingRegistrations = require('../services/pendingRegistrations');
const mailer = require('../services/mailer');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.currentUser) {
    return res.redirect('/account');
  }

  const { returnUrl = '' } = req.query || {};

  res.render('login/login', {
    title: 'Đăng nhập',
    form: {
      email: '',
      remember: false,
    },
    returnUrl,
  });
});

router.post('/login', async (req, res) => {
  const { email = '', password = '', remember, returnUrl = '' } = req.body || {};

  const errors = {};
  if (!email.trim()) {
    errors.email = 'Vui lòng nhập email.';
  }
  if (!password.trim()) {
    errors.password = 'Vui lòng nhập mật khẩu.';
  }

  let user = null;
  if (!errors.email) {
    user = await dataService.getUserByEmail(email);
    if (!user) {
      errors.email = 'Không tìm thấy tài khoản với email này.';
    }
  }

  if (!errors.password && user) {
    const hasPasswordHash = Boolean(user.passwordHash);
    if (hasPasswordHash) {
      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) {
        errors.password = 'Mật khẩu không chính xác.';
      }
    } else if (password !== '123456') {
      errors.password = 'Mật khẩu không chính xác (gợi ý: 123456).';
    }
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).render('login/login', {
      title: 'Đăng nhập',
      form: {
        email,
        remember: Boolean(remember),
      },
      errors,
      returnUrl,
    });
  }

  const normalizedStatus = String(user.status || '').toLowerCase();
  if (normalizedStatus === 'banned') {
    return res.status(403).render('login/login', {
      title: 'Đăng nhập',
      form: {
        email,
        remember: Boolean(remember),
      },
      errors: {
        global: 'Tài khoản của bạn tạm khóa! Vui lòng liên hệ admin để khắc phục qua email: example@gmail.com',
      },
      returnUrl,
    });
  }

  const cookieOptions = { httpOnly: true };
  if (remember) {
    cookieOptions.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
  }
  
  res.cookie('userId', user.id, cookieOptions);
  res.redirect(returnUrl || '/');
});

router.get('/register', (req, res) => {
  if (req.currentUser) {
    return res.redirect('/account');
  }

  res.render('login/register', {
    title: 'Đăng ký tài khoản',
    form: {
      name: '',
      email: '',
      address: '',
    },
  });
});

router.post('/register', async (req, res) => {
  const { name = '', email = '', address = '', password = '', confirmPassword = '', 'g-recaptcha-response': captchaToken } =
    req.body || {};

  const errors = {};
  const trimmedName = name.trim();
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedAddress = address.trim();

  if (!trimmedName) {
    errors.name = 'Vui lòng nhập họ tên đầy đủ.';
  }
  if (!trimmedAddress) {
    errors.address = 'Vui lòng nhập địa chỉ liên hệ.';
  }
  if (!trimmedEmail) {
    errors.email = 'Vui lòng nhập email.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    errors.email = 'Email không hợp lệ.';
  } else if (await dataService.getUserByEmail(trimmedEmail)) {
    errors.email = 'Email đã tồn tại. Vui lòng sử dụng email khác.';
  }

  if (!password) {
    errors.password = 'Vui lòng nhập mật khẩu.';
  } else if (password.length < 6) {
    errors.password = 'Mật khẩu cần ít nhất 6 ký tự.';
  }
  if (!confirmPassword) {
    errors.confirmPassword = 'Vui lòng xác nhận mật khẩu.';
  } else if (password !== confirmPassword) {
    errors.confirmPassword = 'Mật khẩu xác nhận không khớp.';
  }

  if (!captchaToken) {
    errors.recaptcha = 'Vui lòng xác minh reCAPTCHA.';
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).render('login/register', {
      title: 'Đăng ký tài khoản',
      form: {
        name: trimmedName,
        email: trimmedEmail,
        address: trimmedAddress,
      },
      errors,
    });
  }

  const captchaResult = await verifyRecaptcha(captchaToken, req.ip);
  if (!captchaResult.success) {
    errors.recaptcha = captchaResult.error || 'Không thể xác thực reCAPTCHA.';
    return res.status(400).render('login/register', {
      title: 'Đăng ký tài khoản',
      form: {
        name: trimmedName,
        email: trimmedEmail,
        address: trimmedAddress,
      },
      errors,
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const pending = pendingRegistrations.createPendingRegistration({
    name: trimmedName,
    email: trimmedEmail,
    address: trimmedAddress,
    passwordHash,
  });

  console.info(`OTP cho ${trimmedEmail}: ${pending.otp} (hết hạn sau 10 phút)`);

  let flash = {
    type: 'success',
    message: 'Chúng tôi đã gửi mã OTP tới email của bạn. Vui lòng nhập để hoàn tất đăng ký.',
  };

  try {
    const mailResult = await mailer.sendOtpEmail({
      to: trimmedEmail,
      name: trimmedName,
      otp: pending.otp,
      expiresAt: pending.expiresAt,
    });

    if (mailResult?.skipped) {
      flash = {
        type: 'warning',
        message: 'Hệ thống chưa cấu hình SMTP nên OTP không thể gửi qua email. Liên hệ quản trị viên để được hỗ trợ.',
      };
    }
  } catch (error) {
    console.error('Không thể gửi email OTP:', error);
    return res.status(500).render('login/register', {
      title: 'Đăng ký tài khoản',
      form: {
        name: trimmedName,
        email: trimmedEmail,
        address: trimmedAddress,
      },
      errors: {
        global: 'Không thể gửi email OTP. Vui lòng thử lại sau.',
      },
    });
  }

  res.render('login/verify-otp', {
    title: 'Xác minh OTP',
    registrationId: pending.id,
    email: trimmedEmail,
    expiresAt: pending.expiresAt,
    flash,
  });
});

router.get('/verify-otp', (req, res) => {
  const { id } = req.query || {};
  const registration = pendingRegistrations.getRegistration(id);
  if (!registration) {
    return res.status(400).render('login/register', {
      title: 'Đăng ký tài khoản',
      errors: {
        recaptcha: 'Phiên xác minh đã hết hạn, vui lòng đăng ký lại.',
      },
      form: {
        name: '',
        email: '',
        address: '',
      },
    });
  }

  res.render('login/verify-otp', {
    title: 'Xác minh OTP',
    registrationId: registration.id,
    email: registration.payload.email,
    expiresAt: registration.expiresAt,
  });
});


router.post('/verify-otp', async (req, res) => {
  const { registrationId = '', otp = '' } = req.body || {};
  const trimmedOtp = otp.trim();
  const registration = pendingRegistrations.getRegistration(registrationId);
  const email = registration?.payload?.email || '';
  const result = pendingRegistrations.verifyOtp(registrationId, trimmedOtp);

  if (!result.success) {
    return res.status(400).render('login/verify-otp', {
      title: 'Xác minh OTP',
      registrationId,
      email,
      expiresAt: registration?.expiresAt,
      errors: {
        otp: result.error,
      },
    });
  }

  const { payload } = result;
  const existing = await dataService.getUserByEmail(payload.email);
  if (existing) {
    return res.status(400).render('login/register', {
      title: 'Đăng ký tài khoản',
      errors: {
        email: 'Email đã được sử dụng trước đó.',
      },
      form: {
        name: payload.name,
        email: payload.email,
        address: payload.address,
      },
    });
  }

  const user = await userStore.createUser({
    name: payload.name,
    email: payload.email,
    address: payload.address,
    passwordHash: payload.passwordHash,
  });

  const cookieOptions = { httpOnly: true };
  res.cookie('userId', user.id, cookieOptions);
  res.redirect('/account');
});

router.get('/logout', (req, res) => {
  res.clearCookie('userId');
  res.redirect('/auth/login');
});

module.exports = router;
