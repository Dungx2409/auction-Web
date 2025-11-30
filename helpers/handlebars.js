const dayjs = require('dayjs');
const relativeTime = require('dayjs/plugin/relativeTime');

dayjs.extend(relativeTime);

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
  maskName(name) {
    if (!name) return '';
    if (name.length <= 2) return `${name[0]}*`;
    return `${name.slice(0, 2)}***`;
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
};
