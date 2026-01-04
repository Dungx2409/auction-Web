const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;

function isMailerConfigured() {
  const { host, user, pass, fromAddress } = config.mailer || {};
  return Boolean(host && user && pass && fromAddress);
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mailer.host,
      port: config.mailer.port,
      secure: Boolean(config.mailer.secure),
      auth: {
        user: config.mailer.user,
        pass: config.mailer.pass,
      },
    });
  }
  return transporter;
}

function buildOtpEmail({ otp, name, expiresAt }) {
  const minutesLeft = Math.max(1, Math.round((expiresAt - Date.now()) / 60000));
  const safeName = name || 'bạn';
  return {
    subject: 'Mã OTP xác minh tài khoản Bidder',
    text: `Xin chào ${safeName},\n\nMã OTP của bạn là ${otp}. Mã sẽ hết hạn trong ${minutesLeft} phút.\n\nNếu bạn không yêu cầu đăng ký, hãy bỏ qua email này.`,
    html: `
      <p>Xin chào <strong>${safeName}</strong>,</p>
      <p>Mã OTP để xác minh tài khoản của bạn là:</p>
      <p style="font-size: 22px; font-weight: bold; letter-spacing: 4px;">${otp}</p>
      <p>Mã sẽ hết hạn trong ${minutesLeft} phút.</p>
      <p>Nếu bạn không yêu cầu đăng ký, hãy bỏ qua email này.</p>
      <p>Trân trọng,<br/>Đội ngũ Bidder</p>
    `,
  };
}

async function sendOtpEmail({ to, otp, name, expiresAt }) {
  if (!to || !otp) {
    throw new Error('Missing recipient email or OTP');
  }

  if (!isMailerConfigured()) {
    console.info('[mailer] SMTP chưa cấu hình, bỏ qua gửi email OTP cho %s. OTP: %s', to, otp);
    return { success: false, skipped: true };
  }

  const message = buildOtpEmail({ otp, name, expiresAt });
  const mailTransport = getTransporter();

  await mailTransport.sendMail({
    from: `${config.mailer.fromName} <${config.mailer.fromAddress}>`,
    to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  return { success: true };
}

function buildQuestionNotificationEmail({ sellerName, productTitle, questionText, productUrl, askerName }) {
  const safeSeller = sellerName || 'bạn';
  const safeProduct = productTitle || 'sản phẩm trên Auction Web';
  const safeAsker = askerName || 'Người mua';
  const safeQuestion = questionText || '';
  const link = productUrl || '#';
  const escapedQuestion = escapeHtml(safeQuestion).replace(/\n/g, '<br/>');
  const escapedSeller = escapeHtml(safeSeller);
  const escapedProduct = escapeHtml(safeProduct);
  const escapedAsker = escapeHtml(safeAsker);

  return {
    subject: `Câu hỏi mới về "${safeProduct}"`,
    text: `Xin chào ${safeSeller},\n${safeAsker} vừa đặt câu hỏi về "${safeProduct}":\n"${safeQuestion}"\n\nTrả lời ngay: ${link}\n\nTrân trọng,\nĐội ngũ Auction Web`,
    html: `
      <p>Xin chào <strong>${escapedSeller}</strong>,</p>
      <p><strong>${escapedAsker}</strong> vừa đặt câu hỏi về <em>${escapedProduct}</em>:</p>
      <blockquote style="margin: 0 0 16px 0; padding-left: 12px; border-left: 3px solid #e2e8f0; color: #1f2937;">
        ${escapedQuestion || 'Không có nội dung.'}
      </blockquote>
      <p>
        <a href="${link}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#0f62fe;color:#fff;text-decoration:none;">
          Xem chi tiết sản phẩm & trả lời
        </a>
      </p>
      <p>Trân trọng,<br/>Đội ngũ Auction Web</p>
    `,
  };
}

async function sendQuestionNotificationEmail({ to, sellerName, productTitle, questionText, productUrl, askerName }) {
  if (!to) {
    throw new Error('Missing recipient email for question notification');
  }

  if (!isMailerConfigured()) {
    console.info('[mailer] SMTP chưa cấu hình, bỏ qua gửi email thông báo câu hỏi cho %s.', to);
    return { success: false, skipped: true };
  }

  const message = buildQuestionNotificationEmail({ sellerName, productTitle, questionText, productUrl, askerName });
  const mailTransport = getTransporter();

  await mailTransport.sendMail({
    from: `${config.mailer.fromName} <${config.mailer.fromAddress}>`,
    to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  return { success: true };
}

function buildBidRequestNotificationEmail({ sellerName, bidderName, bidderEmail, productTitle, productUrl, message }) {
  const safeSeller = sellerName || 'bạn';
  const safeBidder = bidderName || 'Một người dùng';
  const safeProduct = productTitle || 'sản phẩm trên Auction Web';
  const link = productUrl || '#';
  const escapedSeller = escapeHtml(safeSeller);
  const escapedBidder = escapeHtml(safeBidder);
  const escapedProduct = escapeHtml(safeProduct);
  const escapedMessage = message ? escapeHtml(message).replace(/\n/g, '<br/>') : '';

  return {
    subject: `Yêu cầu tham gia đấu giá "${safeProduct}"`,
    text: `Xin chào ${safeSeller},\n\n${safeBidder} xin phép được tham gia đấu giá sản phẩm "${safeProduct}".\n\n${message ? `Lời nhắn: "${message}"\n\n` : ''}Vui lòng truy cập trang quản lý tài khoản để chấp thuận hoặc từ chối yêu cầu này.\n\nTrân trọng,\nĐội ngũ Auction Web`,
    html: `
      <p>Xin chào <strong>${escapedSeller}</strong>,</p>
      <p><strong>${escapedBidder}</strong> xin phép được tham gia đấu giá sản phẩm <em>${escapedProduct}</em>.</p>
      ${escapedMessage ? `<blockquote style="margin: 0 0 16px 0; padding-left: 12px; border-left: 3px solid #e2e8f0; color: #1f2937;">${escapedMessage}</blockquote>` : ''}
      <p>
        <a href="${link}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#0f62fe;color:#fff;text-decoration:none;">
          Xem và phản hồi yêu cầu
        </a>
      </p>
      <p>Trân trọng,<br/>Đội ngũ Auction Web</p>
    `,
  };
}

async function sendBidRequestNotificationEmail({ to, sellerName, bidderName, bidderEmail, productTitle, productUrl, message }) {
  if (!to) {
    throw new Error('Missing recipient email for bid request notification');
  }

  if (!isMailerConfigured()) {
    console.info('[mailer] SMTP chưa cấu hình, bỏ qua gửi email thông báo yêu cầu đấu giá cho %s.', to);
    return { success: false, skipped: true };
  }

  const emailContent = buildBidRequestNotificationEmail({ sellerName, bidderName, bidderEmail, productTitle, productUrl, message });
  const mailTransport = getTransporter();

  await mailTransport.sendMail({
    from: `${config.mailer.fromName} <${config.mailer.fromAddress}>`,
    to,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  });

  return { success: true };
}

function buildBidRequestResponseEmail({ bidderName, productTitle, productUrl, approved, sellerNote }) {
  const safeBidder = bidderName || 'bạn';
  const safeProduct = productTitle || 'sản phẩm trên Auction Web';
  const link = productUrl || '#';
  const escapedBidder = escapeHtml(safeBidder);
  const escapedProduct = escapeHtml(safeProduct);
  const escapedNote = sellerNote ? escapeHtml(sellerNote).replace(/\n/g, '<br/>') : '';

  const statusText = approved ? 'chấp thuận' : 'từ chối';
  const statusColor = approved ? '#22c55e' : '#ef4444';

  return {
    subject: approved 
      ? `Yêu cầu đấu giá "${safeProduct}" đã được chấp thuận!` 
      : `Yêu cầu đấu giá "${safeProduct}" đã bị từ chối`,
    text: `Xin chào ${safeBidder},\n\nNgười bán đã ${statusText} yêu cầu tham gia đấu giá sản phẩm "${safeProduct}".\n\n${sellerNote ? `Lời nhắn từ người bán: "${sellerNote}"\n\n` : ''}${approved ? 'Bạn có thể đặt giá ngay bây giờ.' : 'Bạn có thể gửi lại yêu cầu với lời nhắn thuyết phục hơn.'}\n\nTrân trọng,\nĐội ngũ Auction Web`,
    html: `
      <p>Xin chào <strong>${escapedBidder}</strong>,</p>
      <p>Người bán đã <strong style="color: ${statusColor};">${statusText}</strong> yêu cầu tham gia đấu giá sản phẩm <em>${escapedProduct}</em>.</p>
      ${escapedNote ? `<blockquote style="margin: 0 0 16px 0; padding-left: 12px; border-left: 3px solid #e2e8f0; color: #1f2937;">Lời nhắn từ người bán: ${escapedNote}</blockquote>` : ''}
      <p>${approved ? 'Bạn có thể đặt giá ngay bây giờ!' : 'Bạn có thể gửi lại yêu cầu với lời nhắn thuyết phục hơn.'}</p>
      <p>
        <a href="${link}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#0f62fe;color:#fff;text-decoration:none;">
          Xem sản phẩm
        </a>
      </p>
      <p>Trân trọng,<br/>Đội ngũ Auction Web</p>
    `,
  };
}

async function sendBidRequestResponseEmail({ to, bidderName, productTitle, productUrl, approved, sellerNote }) {
  if (!to) {
    throw new Error('Missing recipient email for bid request response');
  }

  if (!isMailerConfigured()) {
    console.info('[mailer] SMTP chưa cấu hình, bỏ qua gửi email phản hồi yêu cầu đấu giá cho %s.', to);
    return { success: false, skipped: true };
  }

  const emailContent = buildBidRequestResponseEmail({ bidderName, productTitle, productUrl, approved, sellerNote });
  const mailTransport = getTransporter();

  await mailTransport.sendMail({
    from: `${config.mailer.fromName} <${config.mailer.fromAddress}>`,
    to,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  });

  return { success: true };
}

// ========== BID SUCCESS NOTIFICATIONS ==========

function buildBidSuccessEmailForBidder({ bidderName, productTitle, productUrl, bidAmount }) {
  const safeBidder = bidderName || 'bạn';
  const safeProduct = productTitle || 'sản phẩm';
  const link = productUrl || '#';

  return {
    subject: `Đặt giá thành công: ${safeProduct}`,
    text: `Xin chào ${safeBidder},\n\nBạn đã đặt giá ${bidAmount} cho sản phẩm "${safeProduct}" thành công.\n\nBạn đang là người dẫn đầu! Hãy theo dõi để không bỏ lỡ cơ hội.\n\nXem sản phẩm: ${link}\n\nTrân trọng,\nĐội ngũ Auction Web`,
    html: `
      <p>Xin chào <strong>${escapeHtml(safeBidder)}</strong>,</p>
      <p>Bạn đã đặt giá <strong style="color: #22c55e;">${escapeHtml(bidAmount)}</strong> cho sản phẩm <em>${escapeHtml(safeProduct)}</em> thành công.</p>
      <p>🎉 <strong>Bạn đang là người dẫn đầu!</strong> Hãy theo dõi để không bỏ lỡ cơ hội.</p>
      <p>
        <a href="${link}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#0f62fe;color:#fff;text-decoration:none;">
          Xem sản phẩm
        </a>
      </p>
      <p>Trân trọng,<br/>Đội ngũ Auction Web</p>
    `,
  };
}

function buildBidNotificationForSeller({ sellerName, productTitle, productUrl, bidderName, bidAmount, bidCount }) {
  const safeSeller = sellerName || 'bạn';
  const safeProduct = productTitle || 'sản phẩm';
  const safeBidder = bidderName || 'Người mua';
  const link = productUrl || '#';

  return {
    subject: `Có người đặt giá mới: ${safeProduct}`,
    text: `Xin chào ${safeSeller},\n\n${safeBidder} vừa đặt giá ${bidAmount} cho sản phẩm "${safeProduct}".\n\nTổng số lượt đặt giá: ${bidCount}\n\nXem chi tiết: ${link}\n\nTrân trọng,\nĐội ngũ Auction Web`,
    html: `
      <p>Xin chào <strong>${escapeHtml(safeSeller)}</strong>,</p>
      <p><strong>${escapeHtml(safeBidder)}</strong> vừa đặt giá <strong style="color: #22c55e;">${escapeHtml(bidAmount)}</strong> cho sản phẩm <em>${escapeHtml(safeProduct)}</em>.</p>
      <p>📊 Tổng số lượt đặt giá: <strong>${bidCount}</strong></p>
      <p>
        <a href="${link}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#0f62fe;color:#fff;text-decoration:none;">
          Xem chi tiết sản phẩm
        </a>
      </p>
      <p>Trân trọng,<br/>Đội ngũ Auction Web</p>
    `,
  };
}

function buildOutbidNotificationEmail({ previousBidderName, productTitle, productUrl, newBidAmount, yourBidAmount }) {
  const safeBidder = previousBidderName || 'bạn';
  const safeProduct = productTitle || 'sản phẩm';
  const link = productUrl || '#';

  return {
    subject: `Bạn đã bị vượt giá: ${safeProduct}`,
    text: `Xin chào ${safeBidder},\n\nCó người vừa đặt giá ${newBidAmount} cho sản phẩm "${safeProduct}", vượt qua giá ${yourBidAmount} của bạn.\n\nHãy đặt giá cao hơn để giành lại vị trí dẫn đầu!\n\nXem sản phẩm: ${link}\n\nTrân trọng,\nĐội ngũ Auction Web`,
    html: `
      <p>Xin chào <strong>${escapeHtml(safeBidder)}</strong>,</p>
      <p>⚠️ Có người vừa đặt giá <strong style="color: #ef4444;">${escapeHtml(newBidAmount)}</strong> cho sản phẩm <em>${escapeHtml(safeProduct)}</em>, vượt qua giá <strong>${escapeHtml(yourBidAmount)}</strong> của bạn.</p>
      <p>Hãy đặt giá cao hơn để giành lại vị trí dẫn đầu!</p>
      <p>
        <a href="${link}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#ef4444;color:#fff;text-decoration:none;">
          Đặt giá ngay
        </a>
      </p>
      <p>Trân trọng,<br/>Đội ngũ Auction Web</p>
    `,
  };
}

async function sendBidSuccessEmail({ to, bidderName, productTitle, productUrl, bidAmount }) {
  if (!to) return { success: false, skipped: true };

  if (!isMailerConfigured()) {
    console.info('[mailer] SMTP chưa cấu hình, bỏ qua gửi email đặt giá thành công cho %s.', to);
    return { success: false, skipped: true };
  }

  const emailContent = buildBidSuccessEmailForBidder({ bidderName, productTitle, productUrl, bidAmount });
  const mailTransport = getTransporter();

  await mailTransport.sendMail({
    from: `${config.mailer.fromName} <${config.mailer.fromAddress}>`,
    to,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  });

  return { success: true };
}

async function sendBidNotificationToSeller({ to, sellerName, productTitle, productUrl, bidderName, bidAmount, bidCount }) {
  if (!to) return { success: false, skipped: true };

  if (!isMailerConfigured()) {
    console.info('[mailer] SMTP chưa cấu hình, bỏ qua gửi email thông báo đặt giá cho seller %s.', to);
    return { success: false, skipped: true };
  }

  const emailContent = buildBidNotificationForSeller({ sellerName, productTitle, productUrl, bidderName, bidAmount, bidCount });
  const mailTransport = getTransporter();

  await mailTransport.sendMail({
    from: `${config.mailer.fromName} <${config.mailer.fromAddress}>`,
    to,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  });

  return { success: true };
}

async function sendOutbidNotificationEmail({ to, previousBidderName, productTitle, productUrl, newBidAmount, yourBidAmount }) {
  if (!to) return { success: false, skipped: true };

  if (!isMailerConfigured()) {
    console.info('[mailer] SMTP chưa cấu hình, bỏ qua gửi email thông báo bị vượt giá cho %s.', to);
    return { success: false, skipped: true };
  }

  const emailContent = buildOutbidNotificationEmail({ previousBidderName, productTitle, productUrl, newBidAmount, yourBidAmount });
  const mailTransport = getTransporter();

  await mailTransport.sendMail({
    from: `${config.mailer.fromName} <${config.mailer.fromAddress}>`,
    to,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  });

  return { success: true };
}

function buildPasswordResetEmail({ userName, newPassword }) {
  const safeName = escapeHtml(userName || 'bạn');
  const safePassword = escapeHtml(newPassword);
  
  return {
    subject: 'Mật khẩu tài khoản của bạn đã được đặt lại - Auction Web',
    text: `Xin chào ${safeName},\n\nMật khẩu tài khoản của bạn trên Auction Web đã được đặt lại bởi quản trị viên.\n\nMật khẩu mới của bạn là: ${newPassword}\n\nVui lòng đăng nhập và đổi mật khẩu ngay để bảo mật tài khoản.\n\nNếu bạn không yêu cầu đặt lại mật khẩu, vui lòng liên hệ với chúng tôi.\n\nTrân trọng,\nĐội ngũ Auction Web`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #0267c1;">Mật khẩu đã được đặt lại</h2>
        <p>Xin chào <strong>${safeName}</strong>,</p>
        <p>Mật khẩu tài khoản của bạn trên <strong>Auction Web</strong> đã được đặt lại bởi quản trị viên.</p>
        <div style="background: #f8f9fa; border-left: 4px solid #0267c1; padding: 16px; margin: 20px 0;">
          <p style="margin: 0 0 8px 0; font-size: 14px; color: #666;">Mật khẩu mới của bạn:</p>
          <p style="margin: 0; font-size: 20px; font-weight: bold; font-family: monospace; letter-spacing: 2px;">${safePassword}</p>
        </div>
        <p style="color: #dc3545; font-weight: 500;">⚠️ Vui lòng đăng nhập và đổi mật khẩu ngay để bảo mật tài khoản.</p>
        <p>Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng liên hệ với chúng tôi.</p>
        <hr style="border: none; border-top: 1px solid #e2e6ef; margin: 24px 0;">
        <p style="color: #666; font-size: 13px;">Trân trọng,<br/><strong>Đội ngũ Auction Web</strong></p>
      </div>
    `,
  };
}

async function sendPasswordResetEmail({ to, userName, newPassword }) {
  if (!to || !newPassword) {
    throw new Error('Missing recipient email or new password');
  }

  if (!isMailerConfigured()) {
    console.info('[mailer] SMTP chưa cấu hình, bỏ qua gửi email reset mật khẩu cho %s.', to);
    return { success: false, skipped: true };
  }

  const message = buildPasswordResetEmail({ userName, newPassword });
  const mailTransport = getTransporter();

  await mailTransport.sendMail({
    from: `${config.mailer.fromName} <${config.mailer.fromAddress}>`,
    to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  return { success: true };
}

module.exports = {
  isMailerConfigured,
  sendOtpEmail,
  sendQuestionNotificationEmail,
  sendBidRequestNotificationEmail,
  sendBidRequestResponseEmail,
  sendBidSuccessEmail,
  sendBidNotificationToSeller,
  sendOutbidNotificationEmail,
  sendPasswordResetEmail,
};
