function setupGallery() {
  document.addEventListener('click', (event) => {
    const thumb = event.target.closest('.thumbs img');
    if (!thumb) return;

    const gallery = thumb.closest('.gallery');
    if (!gallery) return;

    const main = gallery.querySelector('.main');
    if (main) {
      main.src = thumb.src;
    }

    gallery.querySelectorAll('.thumbs img').forEach((img) => img.classList.remove('is-active'));
    thumb.classList.add('is-active');
  });
}

function setupCategorySidebar() {
  const sidebar = document.querySelector('[data-category-sidebar]');
  if (!sidebar) return;

  const toggle = sidebar.querySelector('[data-action="toggle-sidebar"]');
  if (!toggle) return;

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('is-open');
  });

  document.addEventListener('click', (event) => {
    if (!sidebar.classList.contains('is-open')) return;
    if (sidebar.contains(event.target)) return;
    sidebar.classList.remove('is-open');
  });

  window.matchMedia('(min-width: 901px)').addEventListener('change', (mq) => {
    if (mq.matches) {
      sidebar.classList.remove('is-open');
    }
  });
}

function setupPasswordToggle() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-toggle-password]');
    if (!button) return;

    const wrapper = button.closest('.input-password');
    const input = wrapper?.querySelector('input');
    if (!input) return;

    const isVisible = input.type === 'text';
    input.type = isVisible ? 'password' : 'text';
    button.textContent = isVisible ? 'Hiện' : 'Ẩn';
    input.focus();
  });
}

function setupPasswordStrength() {
  const source = document.querySelector('[data-password-source]');
  const indicator = document.querySelector('[data-password-strength]');
  if (!source || !indicator) return;

  const evaluate = (value) => {
    let score = 0;
    if (value.length >= 8) score += 1;
    if (/[A-Z]/.test(value)) score += 1;
    if (/[a-z]/.test(value)) score += 1;
    if (/[0-9]/.test(value)) score += 1;
    if (/[^A-Za-z0-9]/.test(value)) score += 1;
    return score;
  };

  const update = () => {
    const value = source.value || '';
    const score = evaluate(value);
    indicator.dataset.level = score;
    if (!value) {
      indicator.textContent = 'Độ mạnh: —';
      return;
    }

    if (score <= 2) {
      indicator.textContent = 'Độ mạnh: Yếu';
      return;
    }
    if (score === 3) {
      indicator.textContent = 'Độ mạnh: Trung bình';
      return;
    }
    if (score === 4) {
      indicator.textContent = 'Độ mạnh: Mạnh';
      return;
    }
    indicator.textContent = 'Độ mạnh: Rất mạnh';
  };

  source.addEventListener('input', update);
  update();
}

function startCountdowns() {
  document.querySelectorAll('.time-left').forEach((element) => {
    const span = element.querySelector('.countdown');
    const end = new Date(element.dataset.enddate);
    if (!span || Number.isNaN(end.getTime())) return;

    const tick = () => {
      const diffMs = end.getTime() - Date.now();
      if (diffMs <= 0) {
        span.textContent = 'Đã kết thúc';
        return;
      }

      const totalSeconds = Math.floor(diffMs / 1000);
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      const dayText = days > 0 ? `${days}d ` : '';
      span.textContent = `${dayText}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    };

    tick();
    const timer = setInterval(tick, 1000);
    element.addEventListener('auction:stop', () => clearInterval(timer), { once: true });
  });
}

function setupAccountTabs() {
  const sectionsContainer = document.querySelector('[data-account-sections]');
  if (!sectionsContainer) return;

  const panels = Array.from(sectionsContainer.querySelectorAll('[data-account-section]'));
  if (!panels.length) return;

  const tabs = Array.from(document.querySelectorAll('[data-account-tab]')).filter((tab) =>
    tab.closest('.account')
  );

  const allowedSections = new Set(panels.map((panel) => panel.dataset.accountSection).filter(Boolean));

  const resolveSectionFromPath = (pathname) => {
    if (!pathname.startsWith('/account')) return null;
    const parts = pathname.split('/').filter(Boolean);
    const section = parts[1] || 'profile';
    return allowedSections.has(section) ? section : 'profile';
  };

  const updateHistory = (section) => {
    const primaryTab = tabs.find((tab) => tab.dataset.target === section && tab.closest('[data-account-tabs]'));
    const href = primaryTab?.getAttribute('href');
    if (!href || href === '#') return;
    if (window.location.pathname === href) return;
    window.history.replaceState({}, '', href);
  };

  const activate = (section, options = {}) => {
    const { pushHistory = true, focusTab = false } = options;
    if (!section || !allowedSections.has(section)) return;

    panels.forEach((panel) => {
      const isActive = panel.dataset.accountSection === section;
      panel.classList.toggle('is-hidden', !isActive);
      panel.toggleAttribute('hidden', !isActive);
      panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    });

    tabs.forEach((tab) => {
      const matches = tab.dataset.target === section;
      tab.classList.toggle('is-active', matches);
      if (tab.hasAttribute('aria-selected')) {
        tab.setAttribute('aria-selected', matches ? 'true' : 'false');
      }
      if (matches && focusTab) {
        tab.focus();
      }
    });

    sectionsContainer.dataset.activeSection = section;

    if (pushHistory) {
      updateHistory(section);
    }
  };

  const initialSection =
    sectionsContainer.dataset.activeSection ||
    resolveSectionFromPath(window.location.pathname) ||
    panels[0]?.dataset.accountSection ||
    'profile';

  activate(initialSection, { pushHistory: false });

  const onTabInteract = (event) => {
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button && event.button !== 0) return;

    const tab = event.currentTarget;
    if (!tab || tab.getAttribute('aria-disabled') === 'true') {
      event.preventDefault();
      return;
    }

    const target = tab.dataset.target;
    if (!target || !allowedSections.has(target)) return;

    const current = sectionsContainer.dataset.activeSection;
    if (current === target) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    activate(target, { pushHistory: true, focusTab: tab.closest('[data-account-tabs]') != null });
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', onTabInteract);
    tab.addEventListener('keydown', (event) => {
      if (event.code !== 'Space' && event.key !== ' ') return;
      event.preventDefault();
      tab.click();
    });
  });

  window.addEventListener('popstate', () => {
    const sectionFromPath = resolveSectionFromPath(window.location.pathname);
    if (!sectionFromPath) return;
    activate(sectionFromPath, { pushHistory: false, focusTab: true });
  });
}

function setupAdminDashboard() {
  const dashboard = document.querySelector('[data-admin-dashboard]');
  if (!dashboard) return;

  const filterGroup = dashboard.querySelector('[data-admin-filter-group]');
  const filterButtons = filterGroup ? Array.from(filterGroup.querySelectorAll('[data-admin-filter]')) : [];
  const userRows = Array.from(dashboard.querySelectorAll('[data-admin-user]'));
  const detailPanel = dashboard.querySelector('[data-admin-user-detail]');
  const userNameElement = dashboard.querySelector('[data-admin-user-name]');
  const userEmailElement = dashboard.querySelector('[data-admin-user-email]');
  const userRoleElement = dashboard.querySelector('[data-admin-user-role]');
  const userStatusElement = dashboard.querySelector('[data-admin-user-status]');
  const placeholderElement = dashboard.querySelector('[data-admin-user-placeholder]');
  const productsContainer = dashboard.querySelector('[data-admin-user-products]');
  const productsBody = dashboard.querySelector('[data-admin-user-products-body]');
  const productsTitle = dashboard.querySelector('[data-admin-user-products-title]');
  const productsDescription = dashboard.querySelector('[data-admin-user-products-description]');
  const actionsContainer = dashboard.querySelector('[data-admin-user-actions]');
  const banButton = dashboard.querySelector('[data-admin-user-ban]');
  const unbanButton = dashboard.querySelector('[data-admin-user-unban]');
  const currentUserId = Number(dashboard.dataset.currentUserId || 0);

  if (!filterGroup || !filterButtons.length || !userRows.length || !detailPanel || !userNameElement || !userEmailElement || !userRoleElement || !userStatusElement || !placeholderElement || !productsContainer || !productsBody || !productsTitle || !productsDescription || !actionsContainer || !banButton || !unbanButton) {
    return;
  }

  let activeFilter = filterButtons.find((button) => button.classList.contains('is-active'))?.dataset.adminFilter || 'all';
  let activeRow = null;
  let activeUser = null;
  let requestToken = 0;

  const priceFormatter = new Intl.NumberFormat('vi-VN');

  const statusLabels = {
    active: 'Đang hoạt động',
    banned: 'Đã khóa',
    pending: 'Đang chờ duyệt',
  };

  const normalizeStatus = (value) => {
    const normalized = String(value || 'active').toLowerCase();
    return statusLabels[normalized] ? normalized : 'active';
  };

  const getStatusLabel = (status) => statusLabels[status] || status;

  const formatStatus = (status = '') => {
    const normalized = String(status).toLowerCase();
    switch (normalized) {
      case 'active':
        return 'Đang diễn ra';
      case 'ended':
        return 'Đã kết thúc';
      case 'draft':
        return 'Bản nháp';
      case 'removed':
        return 'Đã gỡ';
      default:
        return status || '—';
    }
  };

  const formatPrice = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return '—';
    }
    return `${priceFormatter.format(Math.max(0, numeric))} ₫`;
  };

  const formatDateTime = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('vi-VN', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const clearSelection = () => {
    if (activeRow) {
      activeRow.classList.remove('is-active');
      activeRow = null;
    }
    activeUser = null;

    userNameElement.textContent = 'Chọn người dùng';
    userEmailElement.textContent = '—';
    userRoleElement.textContent = '—';
    userStatusElement.textContent = '—';
    userStatusElement.classList.remove('is-banned', 'is-pending');
    actionsContainer.hidden = true;
    banButton.hidden = false;
    banButton.disabled = false;
    banButton.textContent = 'Khoá tài khoản';
    delete banButton.dataset.userId;
    unbanButton.hidden = true;
    unbanButton.disabled = false;
    unbanButton.textContent = 'Mở khoá tài khoản';
    delete unbanButton.dataset.userId;
    placeholderElement.textContent = 'Chọn một người dùng để xem chi tiết và quản lý hoạt động của họ.';
    placeholderElement.hidden = false;
    productsContainer.hidden = true;
    productsBody.innerHTML = '';
    detailPanel.hidden = true;
    if (productsTitle) {
      productsTitle.textContent = 'Quản lí hoạt động';
    }
    if (productsDescription) {
      productsDescription.textContent = 'Theo dõi hoạt động gần đây của người dùng để can thiệp kịp thời.';
    }
  };

  const markActiveFilter = (targetButton) => {
    filterButtons.forEach((button) => {
      button.classList.toggle('is-active', button === targetButton);
    });
  };

  const setStatusBadge = (status) => {
    const normalized = normalizeStatus(status);
    userStatusElement.textContent = getStatusLabel(normalized);
    userStatusElement.classList.toggle('is-banned', normalized === 'banned');
    userStatusElement.classList.toggle('is-pending', normalized === 'pending');
  };

  const updateRowStatus = (row, status) => {
    if (!row) return;
    const normalized = normalizeStatus(status);
    row.dataset.userStatus = normalized;
    row.classList.toggle('is-banned', normalized === 'banned');
    const statusChip = row.querySelector('.admin-user-status');
    if (statusChip) {
      statusChip.textContent = getStatusLabel(normalized);
      statusChip.classList.toggle('admin-user-status--banned', normalized === 'banned');
      statusChip.classList.toggle('admin-user-status--pending', normalized === 'pending');
    }
  };

  const setProductRowStatus = (row, status, role = 'seller') => {
    if (!row) return;
    const normalized = String(status || '').toLowerCase();
    row.dataset.productStatus = normalized;

    const statusCell = row.querySelector('[data-product-status]');
    if (statusCell) {
      statusCell.textContent = formatStatus(normalized);
    }

    const actionCell = row.querySelector('[data-product-action]');
    if (actionCell) {
      if (role === 'seller') {
        if (normalized === 'removed') {
          actionCell.innerHTML = `<button type="button" class="admin-product-restore" data-product-id="${row.dataset.productId || ''}">Khôi phục</button>`;
        } else {
          actionCell.innerHTML = `<button type="button" class="admin-product-remove" data-product-id="${row.dataset.productId || ''}">Gỡ</button>`;
        }
      } else {
        actionCell.textContent = '—';
      }
    }
  };

  const applyFilter = (role) => {
    activeFilter = role;

    let hasVisibleRow = false;
    userRows.forEach((row) => {
      const matches = role === 'all' || row.dataset.role === role;
      row.hidden = !matches;
      row.classList.toggle('is-filtered-out', !matches);
      if (matches) {
        hasVisibleRow = true;
      }
    });

    if (activeRow && activeRow.hidden) {
      clearSelection();
    }

    if (!hasVisibleRow) {
      placeholderElement.textContent = 'Không có người dùng nào với bộ lọc này.';
      placeholderElement.hidden = false;
      productsContainer.hidden = true;
      detailPanel.hidden = false;
      actionsContainer.hidden = true;
    }
  };

  const renderProducts = (products, { role = 'seller' } = {}) => {
    productsBody.innerHTML = products
      .map((product) => {
        const currentPrice = product.currentPrice ?? product.startPrice;
        const bidCount = Number.isFinite(Number(product.bidCount)) ? Number(product.bidCount) : 0;
        const status = String(product.status || '').toLowerCase();
        let actionCell = '—';

        if (role === 'seller') {
          if (status === 'removed') {
            actionCell = `<button type="button" class="admin-product-restore" data-product-id="${product.id}">Khôi phục</button>`;
          } else {
            actionCell = `<button type="button" class="admin-product-remove" data-product-id="${product.id}">Gỡ</button>`;
          }
        }

        return `
          <tr data-admin-product-row data-product-id="${product.id}" data-product-status="${status}">
            <td>${product.title || '—'}</td>
            <td data-product-status>${formatStatus(status)}</td>
            <td>${formatPrice(currentPrice)}</td>
            <td>${bidCount}</td>
            <td>${formatDateTime(product.endDate)}</td>
            <td data-product-action>${actionCell}</td>
          </tr>
        `;
      })
      .join('');
  };

  const showPlaceholder = (message) => {
    placeholderElement.textContent = message;
    placeholderElement.hidden = false;
    productsContainer.hidden = true;
    productsBody.innerHTML = '';
  };

  const loadUserProducts = async (userId, { role = 'seller', status = 'active' } = {}) => {
    const token = ++requestToken;
    const normalizedRole = (role || 'seller').toLowerCase();
    const normalizedStatus = normalizeStatus(status);

    if (productsTitle) {
      if (normalizedRole === 'seller') {
        productsTitle.textContent = 'Sản phẩm do người bán đăng';
        productsDescription.textContent =
          normalizedStatus === 'banned'
            ? 'Tài khoản đang bị khóa. Kiểm tra kỹ các sản phẩm trước khi mở lại tài khoản.'
            : 'Gỡ sản phẩm vi phạm để dừng hiển thị trên sàn đấu giá.';
      } else if (normalizedRole === 'bidder') {
        productsTitle.textContent = 'Các phiên đấu giá đã tham gia';
        productsDescription.textContent = 'Danh sách sản phẩm mà người dùng đã ra giá gần đây.';
      } else {
        productsTitle.textContent = 'Hoạt động';
        productsDescription.textContent = 'Không có dữ liệu để hiển thị cho vai trò này.';
      }
    }

    if (normalizedRole !== 'seller' && normalizedRole !== 'bidder') {
      showPlaceholder('Vai trò này không có dữ liệu sản phẩm để hiển thị.');
      return;
    }

    const loadingMessage =
      normalizedRole === 'bidder'
        ? 'Đang tải danh sách sản phẩm người dùng đã tham gia đấu giá...'
        : 'Đang tải sản phẩm của người bán...';
    showPlaceholder(loadingMessage);
    detailPanel.hidden = false;

    try {
      const response = await fetch(`/account/admin/users/${userId}/products`, {
        headers: {
          Accept: 'application/json',
        },
        credentials: 'same-origin',
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      if (token !== requestToken) {
        return;
      }

      const products = Array.isArray(payload.products) ? payload.products : [];
      if (!products.length) {
        const emptyMsg =
          normalizedRole === 'bidder'
            ? 'Người dùng chưa tham gia phiên đấu giá nào.'
            : normalizedStatus === 'banned'
            ? 'Tài khoản đã bị khóa. Tất cả sản phẩm của người bán đang bị tạm ẩn.'
            : 'Người bán hiện chưa có sản phẩm nào hoặc tất cả đã bị gỡ.';
        showPlaceholder(emptyMsg);
        return;
      }

      renderProducts(products, { role: normalizedRole });
      placeholderElement.hidden = true;
      productsContainer.hidden = false;
    } catch (error) {
      if (token !== requestToken) {
        return;
      }
      console.error('Không thể tải danh sách sản phẩm của người dùng.', error);
      showPlaceholder('Không thể tải danh sách sản phẩm. Vui lòng thử lại sau.');
    }
  };

  const selectRow = (row) => {
    if (!row || row.hidden) return;

    if (activeRow !== row) {
      if (activeRow) {
        activeRow.classList.remove('is-active');
      }
      activeRow = row;
      activeRow.classList.add('is-active');
    }

    const userName = row.dataset.userName || '—';
    const userEmail = row.dataset.userEmail || '—';
    const roleLabel = row.dataset.userRoleLabel || '—';
    const role = (row.dataset.role || '').toLowerCase();
    const status = normalizeStatus(row.dataset.userStatus);
    const isSelf = Number(row.dataset.userId) === currentUserId;
    const canBan = !isSelf && role !== 'admin';

    userNameElement.textContent = userName;
    userEmailElement.textContent = userEmail;
    userRoleElement.textContent = roleLabel;
    setStatusBadge(status);
    detailPanel.hidden = false;

    activeUser = {
      id: row.dataset.userId,
      role,
      status,
      name: userName,
    };

    if (actionsContainer) {
      if (canBan) {
        actionsContainer.hidden = false;
        banButton.textContent = 'Khoá tài khoản';
        unbanButton.textContent = 'Mở khoá tài khoản';
        banButton.hidden = status === 'banned';
        unbanButton.hidden = status !== 'banned';
        banButton.dataset.userId = row.dataset.userId;
        unbanButton.dataset.userId = row.dataset.userId;
        banButton.disabled = false;
        unbanButton.disabled = false;
      } else {
        actionsContainer.hidden = true;
        delete banButton.dataset.userId;
        delete unbanButton.dataset.userId;
      }
    }

    if (role === 'seller') {
      loadUserProducts(row.dataset.userId, { role: 'seller', status });
      return;
    }

    if (role === 'bidder') {
      loadUserProducts(row.dataset.userId, { role: 'bidder', status });
      return;
    }

    showPlaceholder('Người dùng không có dữ liệu hoạt động để quản lý.');
  };

  filterGroup.addEventListener('click', (event) => {
    const button = event.target.closest('[data-admin-filter]');
    if (!button || !filterGroup.contains(button)) return;

    const nextRole = button.dataset.adminFilter || 'all';
    if (nextRole === activeFilter) return;

    markActiveFilter(button);
    applyFilter(nextRole);
  });

  const tableBody = dashboard.querySelector('[data-admin-user-table] tbody');
  if (tableBody) {
    tableBody.addEventListener('click', (event) => {
      const row = event.target.closest('[data-admin-user]');
      if (!row || row.hidden) return;
      selectRow(row);
    });

    tableBody.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('[data-admin-user]');
      if (!row || row.hidden) return;
      event.preventDefault();
      selectRow(row);
    });
  }

  const handleProductRemove = async (button) => {
    if (!activeUser || activeUser.role !== 'seller') return;

    const productId = Number(button.dataset.productId);
    if (!Number.isFinite(productId) || productId <= 0) return;

    const confirmed = window.confirm('Bạn có chắc chắn muốn gỡ sản phẩm này không?');
    if (!confirmed) return;

    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'Đang gỡ...';

    try {
      const response = await fetch(`/account/admin/products/${productId}/remove`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        credentials: 'same-origin',
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      if (!payload.success) {
        throw new Error('Server did not confirm success.');
      }

      const row = button.closest('[data-admin-product-row]');
      if (row) {
        const nextStatus = payload.product?.status ?? 'removed';
        setProductRowStatus(row, nextStatus, activeUser.role);
      }
    } catch (error) {
      console.error('Không thể gỡ sản phẩm.', error);
      window.alert('Không thể gỡ sản phẩm. Vui lòng thử lại sau.');
      button.disabled = false;
      button.textContent = originalText;
      return;
    }

    button.textContent = originalText;
    button.disabled = false;
  };

  const handleProductRestore = async (button) => {
    if (!activeUser || activeUser.role !== 'seller') return;

    const productId = Number(button.dataset.productId);
    if (!Number.isFinite(productId) || productId <= 0) return;

    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'Đang khôi phục...';

    try {
      const response = await fetch(`/account/admin/products/${productId}/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        credentials: 'same-origin',
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      if (!payload.success) {
        throw new Error('Server did not confirm success.');
      }

      const row = button.closest('[data-admin-product-row]');
      if (row) {
        const nextStatus = payload.product?.status ?? 'active';
        setProductRowStatus(row, nextStatus, activeUser.role);
      }
    } catch (error) {
      console.error('Không thể khôi phục sản phẩm.', error);
      window.alert('Không thể khôi phục sản phẩm. Vui lòng thử lại sau.');
      button.disabled = false;
      button.textContent = originalText;
      return;
    }

    button.textContent = originalText;
    button.disabled = false;
  };

  productsBody.addEventListener('click', (event) => {
    const removeButton = event.target.closest('.admin-product-remove');
    if (removeButton && !removeButton.disabled) {
      handleProductRemove(removeButton);
      return;
    }

    const restoreButton = event.target.closest('.admin-product-restore');
    if (restoreButton && !restoreButton.disabled) {
      handleProductRestore(restoreButton);
    }
  });

  const changeUserStatus = async (action) => {
    if (!activeUser || !activeRow) return;
    const button = action === 'ban' ? banButton : unbanButton;
    const otherButton = action === 'ban' ? unbanButton : banButton;
    const targetId = Number(button.dataset.userId || activeUser.id);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return;
    }

    if (action === 'ban') {
      const confirmed = window.confirm('Bạn có chắc chắn muốn khóa tài khoản người dùng này?');
      if (!confirmed) {
        return;
      }
    }

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = action === 'ban' ? 'Đang khóa...' : 'Đang mở khóa...';
    otherButton.disabled = true;

    try {
      const response = await fetch(`/account/admin/users/${targetId}/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        credentials: 'same-origin',
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      if (!payload.success || !payload.user) {
        throw new Error('Server did not return updated user state.');
      }

      const nextStatus = normalizeStatus(payload.user.status);
  activeUser.id = String(targetId);
      activeUser.status = nextStatus;
      updateRowStatus(activeRow, nextStatus);
      setStatusBadge(nextStatus);

      banButton.hidden = nextStatus === 'banned';
      unbanButton.hidden = nextStatus !== 'banned';
      banButton.disabled = false;
      unbanButton.disabled = false;
      banButton.dataset.userId = String(targetId);
      unbanButton.dataset.userId = String(targetId);

      if (activeUser.role === 'seller' || activeUser.role === 'bidder') {
        loadUserProducts(String(targetId), { role: activeUser.role, status: nextStatus });
      } else {
        showPlaceholder('Người dùng không có dữ liệu hoạt động để quản lý.');
      }
    } catch (error) {
      console.error('Không thể cập nhật trạng thái tài khoản.', error);
      window.alert('Không thể cập nhật trạng thái tài khoản. Vui lòng thử lại sau.');
    } finally {
      button.textContent = originalText;
      button.disabled = false;
      otherButton.disabled = false;
    }
  };

  banButton.addEventListener('click', () => changeUserStatus('ban'));
  unbanButton.addEventListener('click', () => changeUserStatus('unban'));

  clearSelection();
  applyFilter(activeFilter);
}

document.addEventListener('DOMContentLoaded', () => {
  setupGallery();
  setupCategorySidebar();
  setupPasswordToggle();
  setupPasswordStrength();
  startCountdowns();
  setupAccountTabs();
  setupAdminDashboard();
});
