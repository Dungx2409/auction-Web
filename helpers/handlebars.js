const dayjs = require('dayjs');
const relativeTime = require('dayjs/plugin/relativeTime');
const duration = require('dayjs/plugin/duration');

dayjs.extend(relativeTime);
dayjs.extend(duration);

const currencyFormatter = new Intl.NumberFormat('vi-VN', {
	style: 'currency',
	currency: 'VND',
	maximumFractionDigits: 0,
});

const { ORDER_STATUS_LABELS } = require('../services/dataService');

module.exports = {
  formatCurrency(value) {
    if (value == null) return '—';
    return currencyFormatter.format(Number(value));
  },
  formatDate(value, format = 'DD/MM/YYYY HH:mm') {
    if (!value) return '';

    // Handlebars passes the options hash as the last argument; guard against it
    if (typeof format === 'object' && format !== null) {
      format = 'DD/MM/YYYY HH:mm';
    }

    const date = dayjs(value);
    if (!date.isValid()) return '';

    return date.format(format);
  },
  relativeTime(value) {
    return value ? dayjs(value).fromNow() : '';
  },
  countdown(value) {
    if (!value) return '';
    const target = dayjs(value);
    if (!target.isValid()) return '';
    const now = dayjs();
    const diff = target.diff(now);
    if (diff <= 0) {
      return 'Đã kết thúc';
    }
    const span = dayjs.duration(diff);
    const days = Math.floor(span.asDays());
    const hours = span.hours();
    const minutes = span.minutes();
    if (days > 0) {
      return `${days} ngày ${hours} giờ`;
    }
    if (hours > 0) {
      return `${hours} giờ ${minutes} phút`;
    }
    return `${minutes} phút`;
  },
  maskName(name) {
    if (!name) return '';
    const text = String(name).trim();
    if (!text) return '';
    const parts = text.split(/\s+/);
    const last = parts.pop() || '';
    const visible = last.slice(-3);
    const maskedPrefix = '****';
    return `${maskedPrefix}${visible}`;
  },
  add(a, b) {
    return Number(a) + Number(b);
  },
  subtract(a, b) {
    return Number(a) - Number(b);
  },
  gt(a, b) {
    return Number(a) > Number(b);
  },
  lt(a, b) {
    return Number(a) < Number(b);
  },
  eq(a, b) {
    return String(a) === String(b);
  },
  percent(part, total) {
    if (!total) return '0%';
    return `${Math.round((Number(part) / Number(total)) * 100)}%`;
  },
  json(context) {
    return JSON.stringify(context);
  },
  slice(array, start, end) {
    if (!Array.isArray(array)) return [];
    return array.slice(start, end);
  },
  statusLabel(status) {
    const map = {
      active: 'Đang diễn ra',
      draft: 'Bản nháp',
      ended: 'Đã kết thúc',
      removed: 'Đã gỡ',
    };
    const key = String(status || '').toLowerCase();
    return map[key] || 'Không xác định';
  },
  statusClass(status) {
    const map = {
      active: 'status-pill--active',
      draft: 'status-pill--draft',
      ended: 'status-pill--ended',
      removed: 'status-pill--removed',
    };
    const key = String(status || '').toLowerCase();
    return map[key] || 'status-pill--default';
  },
  initial(value) {
    if (!value) return '?';
    const text = String(value).trim();
    if (!text) return '?';
    return text.charAt(0).toUpperCase();
  },
  localizeFulfillmentStatus(status) {
	const key = String(status || '').toLowerCase();
	return ORDER_STATUS_LABELS[key] || status || 'Không xác định';
  },
  or(...values) {
	const options = values.pop();
	return values.some((value) => Boolean(value));
  },
  and(...values) {
	const options = values.pop();
	return values.every((value) => Boolean(value));
  },
  isOrderStageActive(status, stage) {
  const normalizedStatus = String(status || '').toLowerCase();
  const normalizedStage = String(stage || '').toLowerCase();
  if (!normalizedStage) return false;
  switch (normalizedStage) {
    case 'payment':
      return (
        normalizedStatus === 'awaiting_payment_details' ||
        normalizedStatus === 'canceled_by_seller' ||
        normalizedStatus === ''
      );
    case 'seller-confirm':
      return normalizedStatus === 'payment_confirmed_awaiting_delivery';
    case 'delivery':
      return normalizedStatus === 'delivery_confirmed_ready_to_rate';
    case 'feedback':
      return normalizedStatus === 'transaction_completed';
    default:
      return false;
  }
  },
};
