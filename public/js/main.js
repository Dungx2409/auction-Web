/**
 * Loading Spinner - Shows/hides page loader for navigation and AJAX requests
 */
function setupLoadingSpinner() {
  const loader = document.getElementById('page-loader');
  if (!loader) return;

  // Hide loader when page is fully loaded
  function hideLoader() {
    loader.classList.add('is-hidden');
    document.body.classList.remove('is-loading');
  }

  // Show loader
  function showLoader() {
    loader.classList.remove('is-hidden');
    document.body.classList.add('is-loading');
  }

  // Hide loader on initial page load
  if (document.readyState === 'complete') {
    hideLoader();
  } else {
    window.addEventListener('load', hideLoader);
  }

  // Fallback: Hide loader when DOM is ready (in case 'load' event is delayed)
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    hideLoader();
  } else {
    document.addEventListener('DOMContentLoaded', hideLoader);
  }

  // Handle back/forward navigation (bfcache)
  window.addEventListener('pageshow', (event) => {
    // If page is restored from bfcache, hide the loader
    if (event.persisted) {
      hideLoader();
    }
    // Also hide loader on any pageshow event (handles edge cases)
    hideLoader();
  });

  // Show loader when navigating away
  window.addEventListener('beforeunload', () => {
    showLoader();
  });

  // Show loader when clicking internal links
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    
    const href = link.getAttribute('href');
    // Skip if it's an external link, anchor, or has target="_blank"
    if (!href || 
        href.startsWith('#') || 
        href.startsWith('javascript:') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        link.target === '_blank' ||
        link.hasAttribute('download') ||
        event.ctrlKey || 
        event.metaKey || 
        event.shiftKey) {
      return;
    }

    // Skip account tabs - they use client-side navigation
    if (link.hasAttribute('data-account-tab')) {
      return;
    }

    // Check if it's an internal link
    try {
      const linkUrl = new URL(href, window.location.origin);
      if (linkUrl.origin === window.location.origin) {
        showLoader();
      }
    } catch (e) {
      // If URL parsing fails, assume it's internal
      showLoader();
    }
  });

  // Show loader when submitting forms
  document.addEventListener('submit', (event) => {
    const form = event.target;
    // Don't show loader for AJAX forms
    if (form.hasAttribute('data-ajax') || form.hasAttribute('data-no-loader')) {
      return;
    }
    showLoader();
  });

  // Intercept fetch requests to show loader for AJAX
  const originalFetch = window.fetch;
  let activeRequests = 0;
  
  window.fetch = function(...args) {
    activeRequests++;
    if (activeRequests === 1) {
      loader.classList.add('is-ajax-loading');
    }
    
    return originalFetch.apply(this, args)
      .finally(() => {
        activeRequests--;
        if (activeRequests === 0) {
          loader.classList.remove('is-ajax-loading');
        }
      });
  };

  // Expose global functions to control loader
  window.showPageLoader = showLoader;
  window.hidePageLoader = hideLoader;
}

function setupGallery() {
  // Legacy gallery support (non-slideshow)
  document.addEventListener('click', (event) => {
    const thumb = event.target.closest('.thumbs img:not([data-thumb])');
    if (!thumb) return;

    const gallery = thumb.closest('.gallery:not(.slideshow)');
    if (!gallery) return;

    const main = gallery.querySelector('.main');
    if (main) {
      main.src = thumb.src;
    }

    gallery.querySelectorAll('.thumbs img').forEach((img) => img.classList.remove('is-active'));
    thumb.classList.add('is-active');
  });
}

function setupSlideshow() {
  const slideshows = document.querySelectorAll('[data-slideshow]');
  
  slideshows.forEach(slideshow => {
    const slides = slideshow.querySelectorAll('.slideshow-slide');
    const thumbs = slideshow.querySelectorAll('.thumbs img[data-thumb]');
    const dots = slideshow.querySelectorAll('.slideshow-dot');
    const prevBtn = slideshow.querySelector('[data-slide="prev"]');
    const nextBtn = slideshow.querySelector('[data-slide="next"]');
    
    if (slides.length === 0) return;
    
    let currentIndex = 0;
    let isAnimating = false;
    let autoPlayInterval = null;
    
    function goToSlide(index, direction = 'next') {
      if (isAnimating || index === currentIndex) return;
      if (index < 0) index = slides.length - 1;
      if (index >= slides.length) index = 0;
      
      isAnimating = true;
      
      const currentSlide = slides[currentIndex];
      const nextSlide = slides[index];
      
      // Determine animation direction
      const outClass = direction === 'next' ? 'slide-out-left' : 'slide-out-right';
      const inClass = direction === 'next' ? 'slide-in-left' : 'slide-in-right';
      
      // Animate out current slide
      currentSlide.classList.add(outClass);
      currentSlide.classList.remove('is-active');
      
      // Animate in next slide
      nextSlide.classList.add(inClass, 'is-active');
      
      // Update thumbs
      thumbs.forEach((thumb, i) => {
        thumb.classList.toggle('is-active', i === index);
      });
      
      // Update dots
      dots.forEach((dot, i) => {
        dot.classList.toggle('is-active', i === index);
      });
      
      // Cleanup after animation
      setTimeout(() => {
        currentSlide.classList.remove(outClass);
        nextSlide.classList.remove(inClass);
        isAnimating = false;
      }, 500);
      
      currentIndex = index;
    }
    
    function nextSlide() {
      goToSlide(currentIndex + 1, 'next');
    }
    
    function prevSlide() {
      goToSlide(currentIndex - 1, 'prev');
    }
    
    // Auto play
    function startAutoPlay() {
      stopAutoPlay();
      autoPlayInterval = setInterval(nextSlide, 5000);
    }
    
    function stopAutoPlay() {
      if (autoPlayInterval) {
        clearInterval(autoPlayInterval);
        autoPlayInterval = null;
      }
    }
    
    // Event listeners
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        prevSlide();
        startAutoPlay();
      });
    }
    
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        nextSlide();
        startAutoPlay();
      });
    }
    
    thumbs.forEach((thumb, index) => {
      thumb.addEventListener('click', () => {
        const direction = index > currentIndex ? 'next' : 'prev';
        goToSlide(index, direction);
        startAutoPlay();
      });
    });
    
    dots.forEach((dot, index) => {
      dot.addEventListener('click', () => {
        const direction = index > currentIndex ? 'next' : 'prev';
        goToSlide(index, direction);
        startAutoPlay();
      });
    });
    
    // Keyboard navigation
    slideshow.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') {
        prevSlide();
        startAutoPlay();
      } else if (e.key === 'ArrowRight') {
        nextSlide();
        startAutoPlay();
      }
    });
    
    // Pause on hover
    slideshow.addEventListener('mouseenter', stopAutoPlay);
    slideshow.addEventListener('mouseleave', startAutoPlay);
    
    // Touch swipe support
    let touchStartX = 0;
    let touchEndX = 0;
    
    slideshow.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
      stopAutoPlay();
    }, { passive: true });
    
    slideshow.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].screenX;
      const diff = touchStartX - touchEndX;
      
      if (Math.abs(diff) > 50) {
        if (diff > 0) {
          nextSlide();
        } else {
          prevSlide();
        }
      }
      startAutoPlay();
    }, { passive: true });
    
    // Start auto play
    startAutoPlay();
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

function setupQaThread() {
  const qaSection = document.querySelector('.qa-section');
  if (!qaSection) return;

  const autoResize = (textarea) => {
    const resize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    };

    textarea.addEventListener('input', resize);
    resize();
  };

  qaSection.querySelectorAll('textarea[data-auto-resize]').forEach((textarea) => {
    autoResize(textarea);
  });

  qaSection.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="toggle-reply"]');
    if (!button) return;

    const targetId = button.dataset.target;
    if (!targetId) return;

    const form = qaSection.querySelector(`#${CSS.escape(targetId)}`);
    if (!form) return;

    const isHidden = form.hasAttribute('hidden');
    if (isHidden) {
      form.removeAttribute('hidden');
      const textarea = form.querySelector('textarea');
      textarea?.focus();
      textarea?.dispatchEvent(new Event('input'));
    } else {
      form.setAttribute('hidden', 'hidden');
    }
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

function setupFulfillmentFocus() {
  const container = document.querySelector('.fulfillment-view[data-focus-target]');
  if (!container) return;
  const targetId = container.getAttribute('data-focus-target');
  if (!targetId) return;
  const selector = window.CSS && typeof window.CSS.escape === 'function'
    ? `#${window.CSS.escape(targetId)}`
    : `#${targetId}`;
  const anchor = document.querySelector(selector);
  if (!anchor) return;
  setTimeout(() => {
    anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 120);
}

function setupAdminDashboard() {
  const dashboard = document.querySelector('[data-admin-dashboard]');
  if (!dashboard) return;

  // Main panels
  const usersPanel = dashboard.querySelector('[data-admin-users-panel]');
  const detailPanel = dashboard.querySelector('[data-admin-user-detail]');
  const backButton = dashboard.querySelector('[data-admin-back-to-list]');

  // Filter elements
  const filterGroup = dashboard.querySelector('[data-admin-filter-group]');
  const filterButtons = filterGroup ? Array.from(filterGroup.querySelectorAll('[data-admin-filter]')) : [];
  const userRows = Array.from(dashboard.querySelectorAll('[data-admin-user]'));

  // Detail panel elements
  const userNameElement = dashboard.querySelector('[data-admin-user-name]');
  const userEmailElement = dashboard.querySelector('[data-admin-user-email]');
  const userRoleElement = dashboard.querySelector('[data-admin-user-role]');
  const userStatusElement = dashboard.querySelector('[data-admin-user-status]');
  const placeholderElement = dashboard.querySelector('[data-admin-user-placeholder]');
  const productsContainer = dashboard.querySelector('[data-admin-user-products]');
  const productsBody = dashboard.querySelector('[data-admin-user-products-body]');
  const productsTitle = dashboard.querySelector('[data-admin-user-products-title]');
  const productsDescription = dashboard.querySelector('[data-admin-user-products-description]');
  const biddingProductsContainer = dashboard.querySelector('[data-admin-user-bidding-products]');
  const biddingProductsBody = dashboard.querySelector('[data-admin-user-bidding-body]');
  const actionsContainer = dashboard.querySelector('[data-admin-user-actions]');
  const banButton = dashboard.querySelector('[data-admin-user-ban]');
  const unbanButton = dashboard.querySelector('[data-admin-user-unban]');
  const resetPasswordButton = dashboard.querySelector('[data-admin-user-reset-password]');
  const currentUserId = Number(dashboard.dataset.currentUserId || 0);

  if (!usersPanel || !detailPanel || !filterGroup || !filterButtons.length) {
    return;
  }

  let activeFilter = filterButtons.find((button) => button.classList.contains('is-active'))?.dataset.adminFilter || 'all';
  let activeRow = null;
  let activeUser = null;
  let requestToken = 0;

  const priceFormatter = new Intl.NumberFormat('vi-VN');

  const statusLabels = {
    active: 'Active',
    banned: 'Locked',
    pending: 'Pending',
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

  // Show user list, hide detail panel
  const showUserList = () => {
    usersPanel.hidden = false;
    detailPanel.hidden = true;
    if (activeRow) {
      activeRow.classList.remove('is-active');
      activeRow = null;
    }
    activeUser = null;
  };

  // Show detail panel, hide user list
  const showUserDetail = () => {
    usersPanel.hidden = true;
    detailPanel.hidden = false;
  };

  const clearSelection = () => {
    if (activeRow) {
      activeRow.classList.remove('is-active');
      activeRow = null;
    }
    activeUser = null;

    if (userNameElement) userNameElement.textContent = 'Chọn người dùng';
    if (userEmailElement) userEmailElement.textContent = '—';
    if (userRoleElement) userRoleElement.textContent = '—';
    if (userStatusElement) {
      userStatusElement.textContent = '—';
      userStatusElement.classList.remove('is-banned', 'is-pending');
    }
    if (actionsContainer) actionsContainer.hidden = true;
    if (banButton) {
      banButton.hidden = false;
      banButton.disabled = false;
      banButton.textContent = 'Khoá tài khoản';
      delete banButton.dataset.userId;
    }
    if (unbanButton) {
      unbanButton.hidden = true;
      unbanButton.disabled = false;
      unbanButton.textContent = 'Mở khoá tài khoản';
      delete unbanButton.dataset.userId;
    }
    if (placeholderElement) {
      placeholderElement.textContent = 'Đang tải dữ liệu...';
      placeholderElement.hidden = false;
    }
    if (productsContainer) productsContainer.hidden = true;
    if (productsBody) productsBody.innerHTML = '';
    if (biddingProductsContainer) biddingProductsContainer.hidden = true;
    if (biddingProductsBody) biddingProductsBody.innerHTML = '';
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
  };

  const renderProducts = (products, { role = 'seller' } = {}) => {
    // Format seller product status with badges
    const formatSellerStatus = (status) => {
      const normalized = String(status || '').toLowerCase();
      switch (normalized) {
        case 'active':
          return '<span class="badge badge-info">Đang diễn ra</span>';
        case 'ended':
          return '<span class="badge badge-secondary">Đã kết thúc</span>';
        case 'draft':
          return '<span class="badge badge-draft">Nháp</span>';
        case 'removed':
          return '<span class="badge badge-danger">Đã gỡ</span>';
        default:
          return formatStatus(normalized);
      }
    };

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
            <td data-product-status>${formatSellerStatus(status)}</td>
            <td>${formatPrice(currentPrice)}</td>
            <td>${bidCount}</td>
            <td>${formatDateTime(product.endDate)}</td>
            <td data-product-action>${actionCell}</td>
          </tr>
        `;
      })
      .join('');
  };

  // Render bidding products for sellers who also bid
  // Format bidding status based on auction state and whether user is winning
  const formatBiddingStatus = (product) => {
    const status = String(product.status || '').toLowerCase();
    const isWinning = product.isWinning;

    if (status === 'ended') {
      if (isWinning) {
        return '<span class="badge badge-success">Đã thắng</span>';
      } else {
        return '<span class="badge badge-danger">Đã thua</span>';
      }
    } else if (status === 'active') {
      if (isWinning) {
        return '<span class="badge badge-info">Đang dẫn đầu</span>';
      } else {
        return '<span class="badge badge-warning">Đang tham gia</span>';
      }
    } else {
      return formatStatus(status);
    }
  };

  const renderBiddingProducts = (products) => {
    if (!biddingProductsBody) return;
    biddingProductsBody.innerHTML = products
      .map((product) => {
        const currentPrice = product.currentPrice ?? product.startPrice;
        const myBid = product.myBid ?? 0;
        const bidCount = Number.isFinite(Number(product.bidCount)) ? Number(product.bidCount) : 0;
        const status = String(product.status || '').toLowerCase();

        return `
          <tr data-product-id="${product.id}" data-product-status="${status}">
            <td>${product.title || '—'}</td>
            <td>${formatBiddingStatus(product)}</td>
            <td>${formatPrice(currentPrice)}</td>
            <td>${formatPrice(myBid)}</td>
            <td>${bidCount}</td>
            <td>${formatDateTime(product.endDate)}</td>
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
    if (biddingProductsContainer) biddingProductsContainer.hidden = true;
    if (biddingProductsBody) biddingProductsBody.innerHTML = '';
  };

  const loadUserProducts = async (userId, { role = 'seller', status = 'active' } = {}) => {
    const token = ++requestToken;
    const normalizedRole = (role || 'seller').toLowerCase();
    const normalizedStatus = normalizeStatus(status);

    // Hide bidding products by default
    if (biddingProductsContainer) biddingProductsContainer.hidden = true;
    if (biddingProductsBody) biddingProductsBody.innerHTML = '';

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
    placeholderElement.textContent = loadingMessage;
    placeholderElement.hidden = false;
    productsContainer.hidden = true;

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
      const biddingProducts = Array.isArray(payload.biddingProducts) ? payload.biddingProducts : [];

      // Handle seller: show both selling products and bidding products
      if (normalizedRole === 'seller') {
        if (!products.length && !biddingProducts.length) {
          showPlaceholder(
            normalizedStatus === 'banned'
              ? 'Tài khoản đã bị khóa.'
              : 'Người bán chưa có sản phẩm nào và chưa tham gia đấu giá nào.'
          );
          return;
        }

        // Show selling products
        if (products.length) {
          renderProducts(products, { role: 'seller' });
          placeholderElement.hidden = true;
          productsContainer.hidden = false;
        } else {
          productsContainer.hidden = true;
          placeholderElement.textContent = 'Người bán chưa đăng sản phẩm nào.';
          placeholderElement.hidden = false;
        }

        // Show bidding products
        if (biddingProducts.length && biddingProductsContainer && biddingProductsBody) {
          renderBiddingProducts(biddingProducts);
          biddingProductsContainer.hidden = false;
          // If we have bidding products, hide placeholder
          if (products.length) {
            placeholderElement.hidden = true;
          }
        }
        return;
      }

      // Handle bidder
      if (!products.length) {
        showPlaceholder('Người dùng chưa tham gia phiên đấu giá nào.');
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

    if (userNameElement) userNameElement.textContent = userName;
    if (userEmailElement) userEmailElement.textContent = userEmail;
    if (userRoleElement) userRoleElement.textContent = roleLabel;
    setStatusBadge(status);
    
    // Show detail panel, hide user list
    showUserDetail();

    activeUser = {
      id: row.dataset.userId,
      role,
      status,
      name: userName,
    };

    if (actionsContainer) {
      if (canBan) {
        actionsContainer.hidden = false;
        if (banButton) {
          banButton.textContent = 'Khoá tài khoản';
          banButton.hidden = status === 'banned';
          banButton.dataset.userId = row.dataset.userId;
          banButton.disabled = false;
        }
        if (unbanButton) {
          unbanButton.textContent = 'Mở khoá tài khoản';
          unbanButton.hidden = status !== 'banned';
          unbanButton.dataset.userId = row.dataset.userId;
          unbanButton.disabled = false;
        }
        if (resetPasswordButton) {
          resetPasswordButton.hidden = false;
          resetPasswordButton.disabled = false;
        }
      } else {
        actionsContainer.hidden = true;
        if (banButton) delete banButton.dataset.userId;
        if (unbanButton) delete unbanButton.dataset.userId;
        if (resetPasswordButton) resetPasswordButton.hidden = true;
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

  // Back button - return to user list
  if (backButton) {
    backButton.addEventListener('click', () => {
      showUserList();
    });
  }

  // Handle "View detail" button click
  dashboard.addEventListener('click', (event) => {
    const viewDetailBtn = event.target.closest('[data-view-user-detail]');
    if (viewDetailBtn) {
      const userId = viewDetailBtn.dataset.userId;
      const row = dashboard.querySelector(`[data-admin-user][data-user-id="${userId}"]`);
      if (row) {
        selectRow(row);
      }
      return;
    }
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

  // Reset password handler
  if (resetPasswordButton) {
    resetPasswordButton.addEventListener('click', async () => {
      if (!activeUser?.id) return;

      const targetId = activeUser.id;
      const userName = activeUser.name || 'người dùng này';

      const confirmed = window.confirm(`Bạn có chắc chắn muốn reset mật khẩu cho "${userName}"?\n\nMật khẩu mới sẽ được tạo tự động và gửi qua email cho người dùng.`);
      if (!confirmed) return;

      const originalText = resetPasswordButton.textContent;
      resetPasswordButton.disabled = true;
      resetPasswordButton.textContent = 'Đang xử lý...';

      try {
        const response = await fetch(`/account/admin/users/${targetId}/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || 'Không thể reset mật khẩu.');
        }

        if (payload.emailSent) {
          window.alert('Mật khẩu đã được đặt lại thành công!\n\nEmail thông báo mật khẩu mới đã được gửi cho người dùng.');
        } else {
          window.alert('Mật khẩu đã được đặt lại thành công!\n\nLưu ý: Email không được gửi do SMTP chưa cấu hình.');
        }
      } catch (error) {
        console.error('Không thể reset mật khẩu.', error);
        window.alert(error.message || 'Không thể reset mật khẩu. Vui lòng thử lại sau.');
      } finally {
        resetPasswordButton.disabled = false;
        resetPasswordButton.textContent = originalText;
      }
    });
  }

  // Initialize: show user list, hide detail
  showUserList();
  applyFilter(activeFilter);
}

function setupSmoothScrollTriggers() {
  const triggers = document.querySelectorAll('[data-scroll-target]');
  if (!triggers.length) return;

  triggers.forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      const selector = trigger.dataset.scrollTarget;
      if (!selector) return;
      const target = document.querySelector(selector);
      if (!target) return;

      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });

      if (target.classList.contains('qa-section')) {
        target.classList.add('qa-section--highlight');
        setTimeout(() => target.classList.remove('qa-section--highlight'), 1500);
      }
    });
  });
}

const bidCommaFormatter = new Intl.NumberFormat('en-US');
const bidCurrencyFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

function formatBidCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return bidCurrencyFormatter.format(Math.max(0, Math.floor(amount)));
}

function formatBidInputValue(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return bidCommaFormatter.format(Math.max(0, Math.floor(amount)));
}

function parseBidAmount(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }
  if (typeof value !== 'string') return NaN;
  const digits = value.replace(/[^0-9]/g, '');
  if (!digits) return NaN;
  return Number(digits);
}

function applyBidUpdateFromResponse(productPayload = {}, latestBid = null) {
  const payload = productPayload || {};
  const currentPriceEl = document.querySelector('[data-current-price]');
  if (currentPriceEl && payload.currentPriceFormatted) {
    currentPriceEl.textContent = payload.currentPriceFormatted;
  }

  const suggestedPriceEl = document.querySelector('[data-suggested-price]');
  if (suggestedPriceEl) {
    if (payload.suggestedBidFormatted) {
      suggestedPriceEl.textContent = payload.suggestedBidFormatted;
    } else if (typeof payload.suggestedBid === 'number') {
      suggestedPriceEl.textContent = formatBidCurrency(payload.suggestedBid);
    }
  }

  const bidCountEl = document.querySelector('[data-bid-count]');
  if (bidCountEl && typeof payload.bidCount === 'number') {
    bidCountEl.textContent = payload.bidCount;
  }

  const leaderEl = document.querySelector('[data-bid-leader]');
  if (leaderEl && typeof payload.leaderDisplay === 'string') {
    leaderEl.textContent = payload.leaderDisplay;
  }

  const input = document.querySelector('[data-bid-input]');
  if (input) {
    if (typeof payload.nextMinimumBid === 'number') {
      input.dataset.minBid = String(payload.nextMinimumBid);
    }
    if (typeof payload.bidStep === 'number') {
      input.dataset.bidStep = String(payload.bidStep);
    }
    if (typeof payload.currentPrice === 'number') {
      input.dataset.baseAmount = String(payload.currentPrice);
    }

    const nextSuggested = Number.isFinite(payload.suggestedBid)
      ? payload.suggestedBid
      : Number.isFinite(payload.nextMinimumBid)
      ? payload.nextMinimumBid
      : parseBidAmount(input.dataset.rawValue || input.dataset.minBid || '');

    if (Number.isFinite(nextSuggested)) {
      input.dataset.rawValue = String(nextSuggested);
      input.value = formatBidInputValue(nextSuggested);
    }
  }

  document.querySelectorAll('[data-bid-trigger]').forEach((button) => {
    if (typeof payload.suggestedBid === 'number') {
      button.dataset.suggestedBid = payload.suggestedBid;
    }
    if (typeof payload.bidStep === 'number') {
      button.dataset.bidStep = payload.bidStep;
    }
    if (typeof payload.nextMinimumBid === 'number') {
      button.dataset.minBid = payload.nextMinimumBid;
    }
  });

  if (latestBid) {
    const historyBody = document.querySelector('[data-bid-history]');
    if (historyBody) {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${latestBid.timeText || ''}</td><td>${latestBid.userName || ''}</td><td>${latestBid.amountText || ''}</td>`;
      historyBody.prepend(row);
    }
  }
}

function setupBidInputFormatting() {
  const input = document.querySelector('[data-bid-input]');
  if (!input) return;

  const syncValue = (numericValue) => {
    input.dataset.rawValue = String(numericValue);
    input.value = formatBidInputValue(numericValue);
  };

  const getStep = () => {
    const step = parseBidAmount(input.dataset.bidStep);
    return Number.isFinite(step) && step > 0 ? step : 1000;
  };

  const getMinBid = () => {
    const minBid = parseBidAmount(input.dataset.minBid);
    return Number.isFinite(minBid) ? minBid : 0;
  };

  const getCurrentValue = () => {
    const raw = parseBidAmount(input.dataset.rawValue || input.value);
    return Number.isFinite(raw) ? raw : getMinBid();
  };

  const initialValue = parseBidAmount(
    input.value || input.dataset.initialValue || input.dataset.minBid || input.dataset.rawValue || ''
  );
  if (Number.isFinite(initialValue)) {
    syncValue(initialValue);
  } else {
    input.dataset.rawValue = '';
    input.value = '';
  }

  input.addEventListener('input', () => {
    const numericValue = parseBidAmount(input.value);
    if (!Number.isFinite(numericValue)) {
      input.dataset.rawValue = '';
      input.value = '';
      return;
    }
    syncValue(numericValue);
  });

  input.addEventListener('blur', () => {
    const numericValue = parseBidAmount(input.dataset.rawValue || input.value);
    if (Number.isFinite(numericValue)) {
      syncValue(numericValue);
    }
  });

  // Handle increase/decrease buttons
  const panel = input.closest('.bidding-panel') || document;
  const decreaseBtn = panel.querySelector('[data-bid-decrease]');
  const increaseBtn = panel.querySelector('[data-bid-increase]');

  if (decreaseBtn) {
    decreaseBtn.addEventListener('click', () => {
      const step = getStep();
      const minBid = getMinBid();
      const current = getCurrentValue();
      const newValue = Math.max(minBid, current - step);
      syncValue(newValue);
      input.focus();
    });
  }

  if (increaseBtn) {
    increaseBtn.addEventListener('click', () => {
      const step = getStep();
      const current = getCurrentValue();
      const newValue = current + step;
      syncValue(newValue);
      input.focus();
    });
  }
}

function setupProductTabs() {
  const groups = document.querySelectorAll('[data-product-tabs]');
  if (!groups.length) return;

  groups.forEach((group) => {
    const tabs = Array.from(group.querySelectorAll('[data-tab]'));
    const panels = Array.from(group.querySelectorAll('[data-tab-panel]'));
    if (!tabs.length || !panels.length) return;

    const panelMap = new Map();
    panels.forEach((panel) => {
      const key = panel.dataset.tabPanel;
      if (key) {
        panelMap.set(key, panel);
      }
    });

    const activate = (name) => {
      if (!name || !panelMap.has(name)) return;
      tabs.forEach((tab) => {
        const isActive = tab.dataset.tab === name;
        tab.classList.toggle('is-active', isActive);
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      panels.forEach((panel) => {
        const isActive = panel.dataset.tabPanel === name;
        panel.classList.toggle('is-active', isActive);
        panel.toggleAttribute('hidden', !isActive);
      });
    };

    tabs.forEach((tab) => {
      tab.addEventListener('click', (event) => {
        event.preventDefault();
        if (tab.classList.contains('is-active')) return;
        activate(tab.dataset.tab);
      });
    });

    // Check URL query param for tab
    const urlParams = new URLSearchParams(window.location.search);
    const tabFromUrl = urlParams.get('tab');
    const defaultTab = (tabFromUrl && panelMap.has(tabFromUrl)) 
      ? tabFromUrl 
      : (tabs.find((tab) => tab.classList.contains('is-active'))?.dataset.tab || tabs[0]?.dataset.tab);
    activate(defaultTab);
  });
}

function setupBidConfirmation() {
  const modal = document.querySelector('[data-bid-modal]');
  if (!modal) return;

  const amountDisplay = modal.querySelector('[data-bid-amount]');
  const confirmButton = modal.querySelector('[data-modal-confirm]');
  const closeButtons = modal.querySelectorAll('[data-modal-close]');
  const overlay = modal.querySelector('[data-modal-overlay]');
  const noteElement = modal.querySelector('.modal-note');
  const defaultNote = noteElement?.textContent?.trim() || '';
  let pendingBid = null;

  const setNote = (message, isError = false) => {
    if (!noteElement) return;
    noteElement.textContent = message;
    noteElement.classList.toggle('is-error', Boolean(isError));
  };

  const openModal = (productId, amount) => {
    pendingBid = { productId, amount };
    if (amountDisplay) {
      amountDisplay.textContent = formatBidCurrency(amount);
    }
    setNote(defaultNote, false);
    modal.classList.add('is-open');
    modal.removeAttribute('hidden');
  };

  const closeModal = () => {
    modal.classList.remove('is-open');
    modal.setAttribute('hidden', 'hidden');
    pendingBid = null;
    setNote(defaultNote, false);
  };

  const submitBid = async () => {
    if (!pendingBid?.productId) {
      throw new Error('Thiếu thông tin sản phẩm để đặt giá.');
    }

    const response = await fetch(`/products/${encodeURIComponent(pendingBid.productId)}/bids`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ amount: pendingBid.amount }),
    });

    if (response.status === 401) {
      const returnUrl = encodeURIComponent(
        `${window.location.pathname}${window.location.search}${window.location.hash}`
      );
      window.location.href = `/auth/login?returnUrl=${returnUrl}`;
      return null;
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.success) {
      throw new Error(payload?.error || 'Không thể đặt giá ngay lúc này.');
    }

    applyBidUpdateFromResponse(payload.product || {}, payload.latestBid || null);
    return payload;
  };

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-bid-trigger]');
    if (!trigger) return;
    if (trigger.disabled) return;
    event.preventDefault();

    const productId = trigger.dataset.productId;
    if (!productId) {
      window.alert('Không xác định được sản phẩm để đặt giá.');
      return;
    }

    const panel = trigger.closest('.bidding-panel');
    const input = panel?.querySelector('[data-bid-input]');
    const rawInput = input ? parseBidAmount(input.value || input.dataset.rawValue) : NaN;
    const fallback = parseBidAmount(trigger.dataset.suggestedBid);
    const amount = Number.isFinite(rawInput) && rawInput > 0 ? rawInput : fallback;

    if (!Number.isFinite(amount) || amount <= 0) {
      window.alert('Vui lòng nhập giá hợp lệ trước khi xác nhận.');
      return;
    }

    const minBid = parseBidAmount(input?.dataset.minBid || trigger.dataset.minBid || trigger.dataset.suggestedBid);
    if (Number.isFinite(minBid) && amount < minBid) {
      window.alert(`Giá đặt tối thiểu hiện tại là ${formatBidCurrency(minBid)}.`);
      return;
    }

    openModal(productId, amount);
  });

  [...closeButtons, overlay].forEach((element) => {
    if (!element) return;
    element.addEventListener('click', (event) => {
      event.preventDefault();
      closeModal();
    });
  });

  confirmButton?.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!pendingBid) return;

    confirmButton.disabled = true;
    confirmButton.dataset.loading = 'true';
    setNote('Đang gửi yêu cầu...', false);

    try {
      const payload = await submitBid();
      if (!payload) return;
      closeModal();
      window.alert(payload.message || 'Đặt giá thành công!');
    } catch (error) {
      console.error('Bid submission failed', error);
      setNote(error.message || 'Không thể đặt giá ngay lúc này.', true);
    } finally {
      confirmButton.disabled = false;
      confirmButton.removeAttribute('data-loading');
    }
  });
}

function setupBuyNowButtons() {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-buy-now]');
    if (!button) return;
    if (button.dataset.loading === 'true') return;

    event.preventDefault();
    const productId = button.dataset.productId;
    if (!productId) {
      window.alert('Không xác định được sản phẩm để Mua ngay.');
      return;
    }

    const priceValue = parseBidAmount(button.dataset.buyPrice);
    const priceText = Number.isFinite(priceValue) ? formatBidCurrency(priceValue) : null;
    const confirmMessage = button.dataset.buyConfirm ||
      (priceText ? `Bạn chắc chắn muốn Mua ngay với giá ${priceText}?` : 'Bạn chắc chắn muốn Mua ngay sản phẩm này?');
    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) {
      return;
    }

    button.dataset.loading = 'true';
    button.disabled = true;

    try {
      const response = await fetch(`/products/${encodeURIComponent(productId)}/buy-now`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({}),
      });

      if (response.status === 401) {
        const returnUrl = encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`);
        window.location.href = `/auth/login?returnUrl=${returnUrl}`;
        return;
      }

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Không thể Mua ngay lúc này.');
      }

      window.location.href = payload.redirectUrl || `/products/${productId}`;
    } catch (error) {
      window.alert(error.message || 'Không thể Mua ngay lúc này.');
    } finally {
      button.dataset.loading = 'false';
      button.disabled = false;
    }
  });
}

function setupWatchlistButtons() {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('.watchlist-button');
    if (!button) return;
    const productId = button.dataset.productId;
    if (!productId) return;
    if (button.dataset.loading === 'true') return;

    event.preventDefault();
    button.dataset.loading = 'true';
    button.disabled = true;

    const isWatching =
      button.classList.contains('is-watching') ||
      button.dataset.watchState === 'watching' ||
      button.getAttribute('aria-pressed') === 'true';

    try {
      const response = await fetch(`/products/${encodeURIComponent(productId)}/watchlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ action: isWatching ? 'remove' : 'add' }),
      });

      if (response.status === 401) {
        const returnUrl = encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`);
        window.location.href = `/auth/login?returnUrl=${returnUrl}`;
        return;
      }

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Không thể cập nhật watch list.');
      }

      const nextWatching = Boolean(payload.isWatching);
      const watcherCount =
        typeof payload.watchers === 'number'
          ? payload.watchers
          : typeof payload.watchCount === 'number'
          ? payload.watchCount
          : null;

      button.classList.toggle('is-watching', nextWatching);
      button.setAttribute('aria-pressed', nextWatching ? 'true' : 'false');
      button.dataset.watchState = nextWatching ? 'watching' : 'idle';

      const label = button.querySelector('.watch-copy');
      if (label) {
        label.textContent = nextWatching ? 'Đã lưu' : 'Lưu lại';
      }

      const counter = button.querySelector('.watch-count');
      if (counter && watcherCount != null) {
        counter.textContent = watcherCount;
      }
    } catch (error) {
      console.error('Watch list update failed', error);
      button.classList.add('has-error');
      setTimeout(() => button.classList.remove('has-error'), 1200);
    } finally {
      button.dataset.loading = 'false';
      button.disabled = false;
    }
  });
}

function setupBidRequestButtons() {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-bid-request]');
    if (!button) return;
    event.preventDefault();
    if (button.dataset.loading === 'true') return;

    const productId = button.dataset.productId;
    if (!productId) {
      window.alert('Không xác định được sản phẩm.');
      return;
    }

    const panel = button.closest('[data-bid-request-panel]');
    const messageInput = panel?.querySelector('[data-bid-request-message]');
    const message = messageInput?.value?.trim() || '';

    button.dataset.loading = 'true';
    button.disabled = true;

    try {
      const response = await fetch(`/products/${encodeURIComponent(productId)}/bid-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ message }),
      });

      if (response.status === 401) {
        const returnUrl = encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`);
        window.location.href = `/auth/login?returnUrl=${returnUrl}`;
        return;
      }

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Không thể gửi yêu cầu lúc này.');
      }

      if (messageInput) {
        messageInput.value = '';
      }

      const successMessage = payload.status === 'approved'
        ? 'Yêu cầu của bạn đã được chấp thuận. Hãy thử đặt giá lại nhé!'
        : 'Đã gửi yêu cầu. Vui lòng chờ người bán phê duyệt.';
      window.alert(successMessage);
      window.location.reload();
    } catch (error) {
      window.alert(error.message || 'Không thể gửi yêu cầu ngay lúc này.');
    } finally {
      button.dataset.loading = 'false';
      button.disabled = false;
    }
  });
}

function setupOrderFlowTabs() {
  const statusToPanel = {
    awaiting_payment_details: 'payment',
    payment_confirmed_awaiting_delivery: 'seller-confirm',
    delivery_confirmed_ready_to_rate: 'delivery',
    transaction_completed: 'feedback',
    canceled_by_seller: 'payment',
  };

  document.querySelectorAll('[data-order-flow]').forEach((flow) => {
    const tabs = Array.from(flow.querySelectorAll('[data-order-tab]'));
    const panels = Array.from(flow.querySelectorAll('[data-order-panel]'));
    if (!tabs.length || !panels.length) return;

    const getDefaultTarget = () => {
      const status = String(flow.dataset.orderStatus || '').toLowerCase();
      if (status && statusToPanel[status]) {
        return statusToPanel[status];
      }
      const hash = window.location.hash ? window.location.hash.slice(1) : '';
      if (hash) {
        const hashPanel = panels.find((panel) => panel.id === hash || panel.dataset.orderPanel === hash);
        if (hashPanel) {
          return hashPanel.dataset.orderPanel;
        }
      }
      const activeTab = tabs.find((tab) => tab.classList.contains('is-active'));
      if (activeTab) return activeTab.dataset.orderTab;
      return panels[0].dataset.orderPanel;
    };

    let active = getDefaultTarget();

    const activate = (target, { focusTab = false } = {}) => {
      if (!target) return;
      const targetExists = panels.some((panel) => panel.dataset.orderPanel === target);
      if (!targetExists) return;
      active = target;
      tabs.forEach((tab) => {
        const isMatch = tab.dataset.orderTab === target;
        tab.classList.toggle('is-active', isMatch);
        tab.setAttribute('aria-selected', isMatch ? 'true' : 'false');
        tab.setAttribute('tabindex', isMatch ? '0' : '-1');
        if (isMatch && focusTab) {
          tab.focus();
        }
      });
      panels.forEach((panel) => {
        const isMatch = panel.dataset.orderPanel === target;
        panel.classList.toggle('is-active', isMatch);
        panel.hidden = !isMatch;
        panel.setAttribute('aria-hidden', isMatch ? 'false' : 'true');
      });
    };

    activate(active);

    // Scroll to panel if navigated via hash (e.g., #rating)
    const hash = window.location.hash ? window.location.hash.slice(1) : '';
    if (hash) {
      const targetPanel = panels.find((panel) => panel.id === hash || panel.dataset.orderPanel === hash);
      if (targetPanel) {
        setTimeout(() => {
          targetPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    }

    tabs.forEach((tab) => {
      tab.addEventListener('click', (event) => {
        event.preventDefault();
        activate(tab.dataset.orderTab);
      });
      tab.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate(tab.dataset.orderTab);
      });
    });

    flow.querySelectorAll('[data-order-tab-trigger]').forEach((trigger) => {
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        const target = trigger.dataset.orderTabTrigger;
        if (!target) return;
        activate(target, { focusTab: true });
      });
    });
  });
}

function setupRatingHintButtons() {
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-fill-comment]');
    if (!trigger) return;
    const selector = trigger.dataset.target;
    if (!selector) return;
    const textarea = document.querySelector(selector);
    if (!textarea) return;
    event.preventDefault();
    const snippet = trigger.dataset.fillComment || trigger.textContent.trim();
    if (!snippet) return;
    const current = textarea.value || '';
    const needsSpace = current && !/\s$/.test(current);
    textarea.value = current ? `${current}${needsSpace ? ' ' : ''}${snippet}` : snippet;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  });
}

function setupRatingStars() {
  const cards = document.querySelectorAll('[data-rating-card]');
  if (!cards.length) return;

  cards.forEach((card) => {
    const starsContainer = card.querySelector('[data-rating-stars]');
    if (!starsContainer) return;

    const starIcons = Array.from(starsContainer.querySelectorAll('i.bi'));
    if (!starIcons.length) return;

    const chips = Array.from(card.querySelectorAll('.rating-quick input[name="score"]'));
    if (!chips.length) return;

    const renderStars = (mode) => {
      starIcons.forEach((star, index) => {
        const shouldHighlightPositive = mode === 'positive';
        const shouldHighlightNegative = mode === 'negative' && index < 2;
        star.classList.toggle('is-active', shouldHighlightPositive);
        star.classList.toggle('is-negative', shouldHighlightNegative);
        if (!shouldHighlightPositive) {
          star.classList.remove('is-active');
        }
        if (!shouldHighlightNegative) {
          star.classList.remove('is-negative');
        }
      });
    };

    const applyState = (value) => {
      const numericScore = Number(value);
      if (numericScore > 0) {
        renderStars('positive');
        return;
      }
      if (numericScore < 0) {
        renderStars('negative');
        return;
      }
      renderStars('neutral');
    };

    chips.forEach((chip) => {
      chip.addEventListener('change', () => {
        if (!chip.checked) return;
        applyState(chip.value);
      });
    });

    const checked = chips.find((chip) => chip.checked);
    applyState(checked ? checked.value : 0);
  });
}

function setupInvoiceUploads() {
  const components = document.querySelectorAll('[data-invoice-upload]');
  if (!components.length) return;

  const formatFileSize = (bytes) => {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    const precision = size >= 10 || unitIndex === 0 ? 1 : 2;
    return `${Math.round(size * 10 ** precision) / 10 ** precision} ${units[unitIndex]}`;
  };

  const createDataTransfer = () => {
    try {
      return new DataTransfer();
    } catch (error) {
      return null;
    }
  };

  components.forEach((component) => {
    const input = component.querySelector('[data-upload-input]');
    const previewList = component.querySelector('[data-upload-preview-list]');
    const emptyState = component.querySelector('[data-preview-empty]');
    const plusIndicator = component.querySelector('[data-upload-plus]');
    const feedback = component.querySelector('[data-upload-feedback]');
    const clearButton = component.querySelector('[data-upload-clear]');
    const dropzone = component.querySelector('[data-upload-dropzone]');
    const maxFiles = Number(component.dataset.maxFiles) || 5;
    if (!input || !previewList) return;

    const defaultFeedback = feedback?.textContent.trim() || 'Chưa chọn ảnh nào.';
    const state = { files: [] };
    const previewUrls = new WeakMap();

    const setFeedback = (message, isError = false) => {
      if (!feedback) return;
      feedback.textContent = message;
      feedback.classList.toggle('is-error', Boolean(isError));
    };

    const syncInputFiles = () => {
      const transfer = createDataTransfer();
      if (!transfer) return;
      state.files.forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
    };

    const updateLayout = ({ preserveFeedback = false } = {}) => {
      const hasFiles = state.files.length > 0;
      component.classList.toggle('has-files', hasFiles);
      if (emptyState) emptyState.hidden = hasFiles;
      if (plusIndicator) plusIndicator.hidden = !hasFiles;
      if (clearButton) clearButton.hidden = !hasFiles;
      if (!hasFiles && !preserveFeedback) {
        setFeedback(defaultFeedback, false);
      }
    };

    const renderPreviews = () => {
      previewList.innerHTML = '';
      state.files.forEach((file, index) => {
        let url = previewUrls.get(file);
        if (!url) {
          url = URL.createObjectURL(file);
          previewUrls.set(file, url);
        }

        const card = document.createElement('div');
        card.className = 'invoice-preview-card';
        card.dataset.previewIndex = String(index);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'invoice-preview-remove';
        remove.setAttribute('data-preview-remove', '');
        remove.setAttribute('aria-label', 'Xoá ảnh hoá đơn');
        remove.innerHTML = '<i class="bi bi-x"></i>';

        const figure = document.createElement('div');
        figure.className = 'invoice-preview-image';
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = 'Ảnh hoá đơn đã chọn';
        img.src = url;
        figure.appendChild(img);

        const info = document.createElement('div');
        info.className = 'invoice-preview-info';
        const title = document.createElement('p');
        title.textContent = file.name || 'Ảnh không tên';
        const meta = document.createElement('small');
        meta.textContent = formatFileSize(file.size) || 'Kích thước không xác định';
        info.append(title, meta);

        card.append(remove, figure, info);
        previewList.appendChild(card);
      });

      if (state.files.length > 0) {
        setFeedback(
          state.files.length === 1 ? 'Đã chọn 1 ảnh hoá đơn.' : `Đã chọn ${state.files.length} ảnh hoá đơn.`,
          false
        );
        updateLayout({ preserveFeedback: true });
        return;
      }

      updateLayout();
    };

    const removeFile = (index) => {
      if (index < 0 || index >= state.files.length) return;
      const [removed] = state.files.splice(index, 1);
      if (removed && previewUrls.has(removed)) {
        URL.revokeObjectURL(previewUrls.get(removed));
        previewUrls.delete(removed);
      }
      syncInputFiles();
      renderPreviews();
    };

    const addFiles = (incoming) => {
      const files = Array.from(incoming || []);
      if (!files.length) return;

      let added = 0;
      let blockedMessage = '';

      files.forEach((file) => {
        if (!file.type || !file.type.startsWith('image/')) {
          blockedMessage = 'Chỉ hỗ trợ ảnh định dạng PNG, JPG hoặc JPEG.';
          return;
        }
        if (state.files.length >= maxFiles) {
          blockedMessage = `Chỉ cho phép tối đa ${maxFiles} ảnh hoá đơn.`;
          return;
        }
        state.files.push(file);
        added += 1;
      });

      if (added > 0) {
        renderPreviews();
      }

      syncInputFiles();

      if (blockedMessage) {
        setFeedback(blockedMessage, true);
        updateLayout({ preserveFeedback: true });
      } else if (added > 0) {
        setFeedback(added === 1 ? 'Đã thêm 1 ảnh.' : `Đã thêm ${added} ảnh.`, false);
      }
    };

    previewList.addEventListener('click', (event) => {
      const removeBtn = event.target.closest('[data-preview-remove]');
      if (!removeBtn) return;
      const card = removeBtn.closest('.invoice-preview-card');
      if (!card) return;
      removeFile(Number(card.dataset.previewIndex));
    });

    input.addEventListener('change', () => {
      addFiles(input.files);
    });

    if (clearButton) {
      clearButton.addEventListener('click', () => {
        state.files.splice(0).forEach((file) => {
          if (previewUrls.has(file)) {
            URL.revokeObjectURL(previewUrls.get(file));
            previewUrls.delete(file);
          }
        });
        syncInputFiles();
        previewList.innerHTML = '';
        setFeedback('Đã xoá danh sách ảnh hoá đơn.', false);
        updateLayout({ preserveFeedback: true });
      });
    }

    const dragTarget = dropzone || component;
    if (dragTarget) {
      const activate = () => dragTarget.classList.add('is-dragover');
      const deactivate = () => dragTarget.classList.remove('is-dragover');

      ['dragenter', 'dragover'].forEach((eventName) => {
        dragTarget.addEventListener(eventName, (event) => {
          event.preventDefault();
          activate();
        });
      });

      ['dragleave', 'dragend', 'drop'].forEach((eventName) => {
        dragTarget.addEventListener(eventName, (event) => {
          if (eventName !== 'drop') {
            event.preventDefault();
          }
          deactivate();
        });
      });

      dragTarget.addEventListener('drop', (event) => {
        event.preventDefault();
        if (event.dataTransfer?.files?.length) {
          addFiles(event.dataTransfer.files);
        }
      });
    }

    updateLayout();
  });
}

function setupProductImageUpload() {
  const imageInput = document.getElementById('product-images');
  const previewContainer = document.getElementById('image-preview-container');
  const urlInput = document.getElementById('product-image-urls');
  const urlPreviewContainer = document.getElementById('url-preview-container');
  
  // Setup upload tabs
  const uploadTabs = document.querySelectorAll('.upload-tab');
  const filePanel = document.getElementById('upload-file-panel');
  const urlPanel = document.getElementById('upload-url-panel');
  
  if (uploadTabs.length > 0) {
    uploadTabs.forEach(tab => {
      tab.addEventListener('click', function() {
        const targetTab = this.dataset.tab;
        
        // Update active tab
        uploadTabs.forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        
        // Show/hide panels
        if (targetTab === 'file') {
          if (filePanel) filePanel.style.display = '';
          if (urlPanel) urlPanel.style.display = 'none';
        } else {
          if (filePanel) filePanel.style.display = 'none';
          if (urlPanel) urlPanel.style.display = '';
        }
      });
    });
  }
  
  // URL input preview
  if (urlInput && urlPreviewContainer) {
    function renderUrlPreviews() {
      const urls = urlInput.value
        .split('\n')
        .map(url => url.trim())
        .filter(url => url.length > 0 && (url.startsWith('http://') || url.startsWith('https://')));
      
      urlPreviewContainer.innerHTML = '';
      
      if (urls.length === 0) {
        urlPreviewContainer.innerHTML = '<p class="field-hint" style="grid-column: 1 / -1;">Nhập URL ảnh để xem trước</p>';
        return;
      }
      
      if (urls.length < 3) {
        const warning = document.createElement('p');
        warning.className = 'field-error';
        warning.style.gridColumn = '1 / -1';
        warning.textContent = `Vui lòng nhập ít nhất 3 URL ảnh (hiện tại: ${urls.length} URL)`;
        urlPreviewContainer.appendChild(warning);
      }
      
      urls.forEach((url, index) => {
        const item = document.createElement('div');
        item.className = 'image-preview-item';
        item.innerHTML = `
          <img src="${url}" alt="Ảnh ${index + 1}" onerror="this.parentElement.classList.add('image-error'); this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>❌</text></svg>'" />
          ${index === 0 ? '<span class="image-badge">Ảnh chính</span>' : ''}
        `;
        urlPreviewContainer.appendChild(item);
      });
    }
    
    urlInput.addEventListener('input', renderUrlPreviews);
    urlInput.addEventListener('change', renderUrlPreviews);
    // Initial render
    renderUrlPreviews();
  }
  
  if (!imageInput || !previewContainer) return;

  // Store selected files in an array (to allow accumulation and removal)
  let selectedFiles = [];

  function updateFileInput() {
    const dataTransfer = new DataTransfer();
    selectedFiles.forEach(file => {
      dataTransfer.items.add(file);
    });
    imageInput.files = dataTransfer.files;
  }

  function renderPreviews() {
    previewContainer.innerHTML = '';
    
    if (selectedFiles.length === 0) {
      previewContainer.innerHTML = '<p class="field-hint" style="grid-column: 1 / -1;">Chưa có ảnh nào được chọn</p>';
      return;
    }
    
    if (selectedFiles.length < 3) {
      const warning = document.createElement('p');
      warning.className = 'field-error';
      warning.style.gridColumn = '1 / -1';
      warning.textContent = `Vui lòng chọn ít nhất 3 ảnh (hiện tại: ${selectedFiles.length} ảnh)`;
      previewContainer.appendChild(warning);
    }
    
    selectedFiles.forEach((file, index) => {
      const reader = new FileReader();
      reader.onload = function(e) {
        const item = document.createElement('div');
        item.className = 'image-preview-item';
        item.dataset.index = index;
        item.innerHTML = `
          <img src="${e.target.result}" alt="Ảnh ${index + 1}" />
          <button type="button" class="remove-image" title="Xóa ảnh này">&times;</button>
          ${index === 0 ? '<span class="image-badge">Ảnh chính</span>' : ''}
        `;
        
        // Insert at correct position (async loading may cause order issues)
        const existingItems = previewContainer.querySelectorAll('.image-preview-item');
        let inserted = false;
        for (const existingItem of existingItems) {
          if (parseInt(existingItem.dataset.index) > index) {
            previewContainer.insertBefore(item, existingItem);
            inserted = true;
            break;
          }
        }
        if (!inserted) {
          previewContainer.appendChild(item);
        }
      };
      reader.readAsDataURL(file);
    });
  }

  function addFiles(files) {
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      
      // Check if file already exists (by name and size)
      const exists = selectedFiles.some(f => f.name === file.name && f.size === file.size);
      if (!exists) {
        selectedFiles.push(file);
      }
    });
    
    updateFileInput();
    renderPreviews();
  }

  function removeFile(index) {
    selectedFiles.splice(index, 1);
    updateFileInput();
    renderPreviews();
  }

  // Handle file selection
  imageInput.addEventListener('change', function() {
    addFiles(this.files);
  });

  // Handle remove button clicks
  previewContainer.addEventListener('click', function(e) {
    const removeBtn = e.target.closest('.remove-image');
    if (!removeBtn) return;
    
    const item = removeBtn.closest('.image-preview-item');
    if (!item) return;
    
    const index = parseInt(item.dataset.index);
    removeFile(index);
  });

  // Add drag and drop support
  const container = imageInput.closest('.image-upload-container');
  if (container) {
    ['dragenter', 'dragover'].forEach(eventName => {
      container.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        container.style.borderColor = 'var(--accent)';
        container.style.background = 'var(--accent-soft)';
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      container.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        container.style.borderColor = '';
        container.style.background = '';
      });
    });

    container.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      addFiles(dt.files);
    });
  }
  
  // Initial render
  renderPreviews();
}

function setupCurrencyInputFormatting() {
  const currencyInputs = document.querySelectorAll('.currency-input');
  
  if (!currencyInputs.length) return;

  // Format number with thousand separators (Vietnamese style: 1.000.000)
  function formatCurrency(value) {
    // Remove all non-digit characters
    const numericValue = value.replace(/\D/g, '');
    if (!numericValue) return '';
    
    // Format with dot as thousand separator
    return numericValue.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  // Get raw numeric value from formatted string
  function getRawValue(value) {
    return value.replace(/\./g, '');
  }

  currencyInputs.forEach(input => {
    // Format initial value if present
    if (input.value) {
      const rawValue = getRawValue(input.value);
      input.value = formatCurrency(rawValue);
    }

    // Format on input
    input.addEventListener('input', (e) => {
      const cursorPosition = e.target.selectionStart;
      const oldValue = e.target.value;
      const oldLength = oldValue.length;
      
      // Get raw value and format it
      const rawValue = getRawValue(oldValue);
      const formattedValue = formatCurrency(rawValue);
      
      e.target.value = formattedValue;
      
      // Adjust cursor position based on added/removed dots
      const newLength = formattedValue.length;
      const diff = newLength - oldLength;
      const newCursorPosition = Math.max(0, cursorPosition + diff);
      
      // Set cursor position after formatting
      requestAnimationFrame(() => {
        e.target.setSelectionRange(newCursorPosition, newCursorPosition);
      });
    });

    // Handle paste event
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pastedText = (e.clipboardData || window.clipboardData).getData('text');
      const rawValue = getRawValue(pastedText);
      const formattedValue = formatCurrency(rawValue);
      
      // Insert at cursor position
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      const currentValue = e.target.value;
      const newValue = currentValue.substring(0, start) + formattedValue + currentValue.substring(end);
      
      e.target.value = formatCurrency(getRawValue(newValue));
    });

    // Convert to raw value before form submission
    const form = input.closest('form');
    if (form && !form.dataset.currencyHandlerAttached) {
      form.dataset.currencyHandlerAttached = 'true';
      form.addEventListener('submit', () => {
        form.querySelectorAll('.currency-input').forEach(currencyInput => {
          currencyInput.value = getRawValue(currencyInput.value);
        });
      });
    }
  });
}

// ========== Auto-Bid Setup ==========
function setupAutoBid() {
  const section = document.querySelector('[data-auto-bid-section]');
  if (!section) return;

  const toggleBtn = section.querySelector('[data-auto-bid-toggle]');
  const form = section.querySelector('[data-auto-bid-form]');
  const input = section.querySelector('[data-auto-bid-input]');
  const submitBtn = section.querySelector('[data-auto-bid-submit]');
  const cancelBtn = section.querySelector('[data-auto-bid-cancel]');
  const statusDiv = section.querySelector('[data-auto-bid-status]');
  const currentMaxSpan = section.querySelector('[data-auto-bid-current-max]');
  const minHintSpan = section.querySelector('[data-auto-bid-min]');

  if (!toggleBtn || !form || !input || !submitBtn) return;

  const productId = input.dataset.productId;
  const priceFormatter = new Intl.NumberFormat('vi-VN');

  const formatPrice = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? `${priceFormatter.format(num)} ₫` : '—';
  };

  const parsePrice = (value) => {
    if (typeof value === 'number') return value;
    if (!value) return NaN;
    return Number(String(value).replace(/[^0-9]/g, ''));
  };

  const getMinBid = () => {
    const min = parsePrice(input.dataset.minBid);
    return Number.isFinite(min) ? min : 0;
  };

  const syncInputValue = (numericValue) => {
    input.dataset.rawValue = String(numericValue);
    input.value = priceFormatter.format(numericValue);
  };

  // Toggle form visibility
  toggleBtn.addEventListener('click', () => {
    const isHidden = form.hidden;
    form.hidden = !isHidden;
    toggleBtn.classList.toggle('is-active', isHidden);
    
    if (isHidden) {
      // Load current auto-bid status
      loadAutoBidStatus();
    }
  });

  // Input formatting
  input.addEventListener('input', () => {
    const numericValue = parsePrice(input.value);
    if (Number.isFinite(numericValue)) {
      syncInputValue(numericValue);
    }
  });

  input.addEventListener('blur', () => {
    const raw = parsePrice(input.dataset.rawValue || input.value);
    if (Number.isFinite(raw) && raw > 0) {
      syncInputValue(raw);
    }
  });

  // Increment/decrement with keyboard
  input.addEventListener('keydown', (e) => {
    const step = parsePrice(input.dataset.bidStep) || 100000;
    const minBid = getMinBid();
    const current = parsePrice(input.dataset.rawValue || input.value) || minBid;

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      syncInputValue(current + step);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      syncInputValue(Math.max(minBid, current - step));
    }
  });

  // Load current auto-bid status
  async function loadAutoBidStatus() {
    try {
      const response = await fetch(`/products/${productId}/auto-bid`);
      const data = await response.json();

      if (data.hasAutoBid && data.autoBid) {
        showActiveStatus(data.autoBid.maxPrice);
        syncInputValue(data.autoBid.maxPrice);
      } else {
        hideActiveStatus();
      }
    } catch (error) {
      console.error('[auto-bid] Error loading status:', error);
    }
  }

  function showActiveStatus(maxPrice) {
    if (statusDiv) {
      statusDiv.hidden = false;
      if (currentMaxSpan) currentMaxSpan.textContent = formatPrice(maxPrice);
    }
    if (cancelBtn) cancelBtn.hidden = false;
    submitBtn.textContent = 'Cập nhật giá tối đa';
  }

  function hideActiveStatus() {
    if (statusDiv) statusDiv.hidden = true;
    if (cancelBtn) cancelBtn.hidden = true;
    submitBtn.textContent = 'Kích hoạt đấu giá tự động';
  }

  // Submit auto-bid
  submitBtn.addEventListener('click', async () => {
    const maxPrice = parsePrice(input.dataset.rawValue || input.value);
    const minBid = getMinBid();

    if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
      window.alert('Vui lòng nhập giá tối đa hợp lệ.');
      input.focus();
      return;
    }

    if (maxPrice < minBid) {
      window.alert(`Giá tối đa phải ít nhất ${formatPrice(minBid)}.`);
      input.focus();
      return;
    }

    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Đang xử lý...';

    try {
      const response = await fetch(`/products/${productId}/auto-bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxPrice }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Không thể thiết lập đấu giá tự động.');
      }

      showActiveStatus(data.autoBid.maxPrice);
      
      // Update UI if product price changed
      if (data.product) {
        updateBidUI({
          currentPrice: data.product.currentPrice,
          currentPriceFormatted: data.product.currentPriceFormatted,
          bidCount: data.product.bidCount,
          nextMinimumBid: data.product.nextMinimumBid,
        });

        // Update min hint
        if (minHintSpan && data.product.nextMinimumBid) {
          minHintSpan.textContent = formatPrice(data.product.nextMinimumBid);
          input.dataset.minBid = data.product.nextMinimumBid;
        }
      }

      window.alert(data.message || 'Đã thiết lập đấu giá tự động thành công!');
    } catch (error) {
      console.error('[auto-bid] Error:', error);
      window.alert(error.message || 'Có lỗi xảy ra. Vui lòng thử lại.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });

  // Cancel auto-bid
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      const confirmed = window.confirm('Bạn có chắc chắn muốn hủy đấu giá tự động?');
      if (!confirmed) return;

      const originalText = cancelBtn.textContent;
      cancelBtn.disabled = true;
      cancelBtn.textContent = 'Đang hủy...';

      try {
        const response = await fetch(`/products/${productId}/auto-bid`, {
          method: 'DELETE',
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Không thể hủy đấu giá tự động.');
        }

        hideActiveStatus();
        input.value = '';
        input.dataset.rawValue = '';
        window.alert('Đã hủy đấu giá tự động.');
      } catch (error) {
        console.error('[auto-bid] Error canceling:', error);
        window.alert(error.message || 'Có lỗi xảy ra. Vui lòng thử lại.');
      } finally {
        cancelBtn.disabled = false;
        cancelBtn.textContent = originalText;
      }
    });
  }

  // Helper to update bid UI after auto-bid
  function updateBidUI(payload) {
    const priceDisplay = document.querySelector('[data-current-price]');
    if (priceDisplay && payload.currentPriceFormatted) {
      priceDisplay.textContent = payload.currentPriceFormatted;
    }

    const bidCountDisplay = document.querySelector('[data-bid-count]');
    if (bidCountDisplay && payload.bidCount !== undefined) {
      bidCountDisplay.textContent = payload.bidCount;
    }

    // Update bid input min
    const bidInput = document.querySelector('[data-bid-input]');
    if (bidInput && payload.nextMinimumBid) {
      bidInput.dataset.minBid = payload.nextMinimumBid;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupLoadingSpinner();
  setupGallery();
  setupSlideshow();
  setupCategorySidebar();
  setupPasswordToggle();
  setupPasswordStrength();
  startCountdowns();
  setupAccountTabs();
  setupAdminDashboard();
  setupSmoothScrollTriggers();
  setupQaThread();
  setupProductTabs();
  setupBidInputFormatting();
  setupBidConfirmation();
  setupBuyNowButtons();
  setupWatchlistButtons();
  setupBidRequestButtons();
  setupFulfillmentFocus();
  setupOrderFlowTabs();
  setupRatingHintButtons();
  setupRatingStars();
  setupInvoiceUploads();
  setupProductImageUpload();
  setupCurrencyInputFormatting();
  setupRejectBidderButtons();
  setupUnrejectBidderButtons();
  setupUpgradeRequestButtons();
  setupAdminUpgradeRequests();
  setupUpgradeSuccessBanner();
  setupQuillEditor();
  setupAdminCategoryManagement();
  setupAutoBid();
  setupShipmentProofUpload();
  setupFormValidation();
});

function setupRejectBidderButtons() {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-reject-bidder]');
    if (!button) return;
    if (button.dataset.loading === 'true') return;

    event.preventDefault();

    const productId = button.dataset.productId;
    const bidderId = button.dataset.bidderId;
    const bidderName = button.dataset.bidderName || 'Người mua';

    if (!productId || !bidderId) {
      window.alert('Không xác định được thông tin để từ chối.');
      return;
    }

    const confirmed = window.confirm(
      `Bạn có chắc muốn từ chối ${bidderName}?\n\n` +
      `Sau khi từ chối:\n` +
      `• Người này không thể đấu giá sản phẩm này nữa\n` +
      `• Nếu họ đang dẫn đầu, giá sẽ chuyển cho người thứ nhì`
    );

    if (!confirmed) return;

    button.dataset.loading = 'true';
    button.disabled = true;

    try {
      const response = await fetch(`/products/${encodeURIComponent(productId)}/reject-bidder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ bidderId }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Không thể từ chối người mua ngay lúc này.');
      }

      window.alert(payload.message || 'Đã từ chối người mua thành công.');

      // Reload trang để cập nhật UI
      window.location.reload();
    } catch (error) {
      console.error('Reject bidder failed', error);
      window.alert(error.message || 'Không thể từ chối người mua ngay lúc này.');
    } finally {
      button.dataset.loading = 'false';
      button.disabled = false;
    }
  });
}

function setupUnrejectBidderButtons() {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-unreject-bidder]');
    if (!button) return;
    if (button.dataset.loading === 'true') return;

    event.preventDefault();

    const productId = button.dataset.productId;
    const bidderId = button.dataset.bidderId;
    const bidderName = button.dataset.bidderName || 'Người mua';

    if (!productId || !bidderId) {
      window.alert('Không xác định được thông tin để hoàn tác.');
      return;
    }

    const confirmed = window.confirm(
      `Bạn có chắc muốn hoàn tác từ chối ${bidderName}?\n\n` +
      `Sau khi hoàn tác, người này có thể tiếp tục đấu giá sản phẩm này.`
    );

    if (!confirmed) return;

    button.dataset.loading = 'true';
    button.disabled = true;

    try {
      const response = await fetch(`/products/${encodeURIComponent(productId)}/unreject-bidder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ bidderId }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Không thể hoàn tác từ chối ngay lúc này.');
      }

      window.alert(payload.message || 'Đã hoàn tác từ chối thành công.');

      // Reload trang để cập nhật UI
      window.location.reload();
    } catch (error) {
      console.error('Unreject bidder failed', error);
      window.alert(error.message || 'Không thể hoàn tác từ chối ngay lúc này.');
    } finally {
      button.dataset.loading = 'false';
      button.disabled = false;
    }
  });
}

/**
 * Setup upgrade request button for bidders
 */
function setupUpgradeRequestButtons() {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-upgrade-request-btn]');
    if (!button) return;
    if (button.dataset.loading === 'true') return;

    event.preventDefault();

    const confirmed = window.confirm(
      'Bạn muốn gửi yêu cầu nâng cấp lên Người bán?\n\n' +
      'Sau khi gửi, admin sẽ xem xét và phê duyệt yêu cầu của bạn.'
    );

    if (!confirmed) return;

    button.dataset.loading = 'true';
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'Đang gửi...';

    try {
      const response = await fetch('/account/upgrade-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Không thể gửi yêu cầu lúc này.');
      }

      window.alert(payload.message || 'Yêu cầu đã được gửi thành công!');
      window.location.reload();
    } catch (error) {
      console.error('Upgrade request failed', error);
      window.alert(error.message || 'Không thể gửi yêu cầu lúc này.');
      button.textContent = originalText;
    } finally {
      button.dataset.loading = 'false';
      button.disabled = false;
    }
  });
}

/**
 * Setup admin upgrade request approval/rejection
 */
function setupAdminUpgradeRequests() {
  // Approve upgrade request
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-upgrade-approve]');
    if (!button) return;
    if (button.dataset.loading === 'true') return;

    event.preventDefault();

    const requestId = button.dataset.requestId;
    if (!requestId) return;

    const card = button.closest('[data-upgrade-request]');
    const userName = card?.querySelector('.upgrade-user-name')?.textContent || 'người dùng này';

    const confirmed = window.confirm(
      `Phê duyệt yêu cầu nâng cấp của ${userName}?\n\n` +
      'Tài khoản của họ sẽ được chuyển thành Người bán.'
    );

    if (!confirmed) return;

    button.dataset.loading = 'true';
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'Đang xử lý...';

    try {
      const response = await fetch(`/account/admin/upgrade-requests/${encodeURIComponent(requestId)}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({}),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Không thể phê duyệt yêu cầu lúc này.');
      }

      window.alert(payload.message || 'Đã phê duyệt yêu cầu thành công!');

      // Remove the card from UI or reload
      if (card) {
        card.style.opacity = '0.5';
        card.style.pointerEvents = 'none';
        setTimeout(() => {
          card.remove();
          // Update count badge
          const countBadge = document.querySelector('.upgrade-count-badge');
          if (countBadge) {
            const currentCount = parseInt(countBadge.textContent, 10) || 0;
            const newCount = Math.max(0, currentCount - 1);
            countBadge.textContent = newCount;
            if (newCount === 0) {
              const upgradeSection = document.querySelector('[data-admin-upgrade-requests]');
              if (upgradeSection) upgradeSection.remove();
            }
          }
          // Update stats
          const statsPending = document.querySelector('.stats-strip .has-pending strong');
          if (statsPending) {
            const current = parseInt(statsPending.textContent, 10) || 0;
            statsPending.textContent = Math.max(0, current - 1);
          }
        }, 300);
      }
    } catch (error) {
      console.error('Approve upgrade request failed', error);
      window.alert(error.message || 'Không thể phê duyệt yêu cầu lúc này.');
      button.textContent = originalText;
    } finally {
      button.dataset.loading = 'false';
      button.disabled = false;
    }
  });

  // Reject upgrade request
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-upgrade-reject]');
    if (!button) return;
    if (button.dataset.loading === 'true') return;

    event.preventDefault();

    const requestId = button.dataset.requestId;
    if (!requestId) return;

    const card = button.closest('[data-upgrade-request]');
    const userName = card?.querySelector('.upgrade-user-name')?.textContent || 'người dùng này';

    const reason = window.prompt(
      `Từ chối yêu cầu nâng cấp của ${userName}?\n\n` +
      'Nhập lý do từ chối (không bắt buộc):'
    );

    // User cancelled the prompt
    if (reason === null) return;

    button.dataset.loading = 'true';
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'Đang xử lý...';

    try {
      const response = await fetch(`/account/admin/upgrade-requests/${encodeURIComponent(requestId)}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ adminNote: reason }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Không thể từ chối yêu cầu lúc này.');
      }

      window.alert(payload.message || 'Đã từ chối yêu cầu.');

      // Remove the card from UI
      if (card) {
        card.style.opacity = '0.5';
        card.style.pointerEvents = 'none';
        setTimeout(() => {
          card.remove();
          // Update count badge
          const countBadge = document.querySelector('.upgrade-count-badge');
          if (countBadge) {
            const currentCount = parseInt(countBadge.textContent, 10) || 0;
            const newCount = Math.max(0, currentCount - 1);
            countBadge.textContent = newCount;
            if (newCount === 0) {
              const upgradeSection = document.querySelector('[data-admin-upgrade-requests]');
              if (upgradeSection) upgradeSection.remove();
            }
          }
          // Update stats
          const statsPending = document.querySelector('.stats-strip .has-pending strong');
          if (statsPending) {
            const current = parseInt(statsPending.textContent, 10) || 0;
            statsPending.textContent = Math.max(0, current - 1);
          }
        }, 300);
      }
    } catch (error) {
      console.error('Reject upgrade request failed', error);
      window.alert(error.message || 'Không thể từ chối yêu cầu lúc này.');
      button.textContent = originalText;
    } finally {
      button.dataset.loading = 'false';
      button.disabled = false;
    }
  });
}

/**
 * Setup upgrade success banner for newly upgraded sellers
 */
function setupUpgradeSuccessBanner() {
  const banner = document.querySelector('[data-upgrade-success-banner]');
  if (!banner) return;

  const closeBtn = banner.querySelector('[data-upgrade-success-close]');

  // Mark notification as seen when banner is displayed
  async function markNotificationSeen() {
    try {
      await fetch('/account/upgrade-notification/seen', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
    } catch (error) {
      console.error('Failed to mark upgrade notification as seen', error);
    }
  }

  // Close banner with animation
  function closeBanner() {
    banner.classList.add('is-hiding');
    setTimeout(() => {
      banner.remove();
    }, 300);
  }

  // Mark as seen immediately when page loads
  markNotificationSeen();

  // Close button handler
  if (closeBtn) {
    closeBtn.addEventListener('click', closeBanner);
  }

  // Auto-close after 15 seconds
  setTimeout(() => {
    if (document.body.contains(banner)) {
      closeBanner();
    }
  }, 15000);
}

/**
 * Setup Quill WYSIWYG Editor for product description
 */
function setupQuillEditor() {
  const editorContainer = document.getElementById('quill-editor');
  const hiddenTextarea = document.getElementById('product-full-description');
  
  if (!editorContainer || !hiddenTextarea) return;
  
  // Check if Quill is loaded
  if (typeof Quill === 'undefined') {
    console.warn('Quill.js not loaded, falling back to textarea');
    editorContainer.style.display = 'none';
    hiddenTextarea.hidden = false;
    return;
  }

  // Quill toolbar configuration
  const toolbarOptions = [
    [{ 'header': [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ 'color': [] }, { 'background': [] }],
    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
    [{ 'indent': '-1'}, { 'indent': '+1' }],
    [{ 'align': [] }],
    ['blockquote'],
    ['link'],
    ['clean']
  ];

  // Initialize Quill
  const quill = new Quill(editorContainer, {
    theme: 'snow',
    modules: {
      toolbar: toolbarOptions
    },
    placeholder: 'Thông số kỹ thuật, tình trạng, phụ kiện đi kèm...'
  });

  // Load existing content from textarea
  const existingContent = hiddenTextarea.value.trim();
  if (existingContent) {
    // Check if content is HTML
    if (existingContent.startsWith('<') && existingContent.includes('>')) {
      quill.root.innerHTML = existingContent;
    } else {
      // Plain text - convert to paragraphs
      quill.setText(existingContent);
    }
  }

  // Sync Quill content to hidden textarea on text change
  quill.on('text-change', () => {
    const html = quill.root.innerHTML;
    // Don't save empty editor state
    if (html === '<p><br></p>' || html === '<p></p>') {
      hiddenTextarea.value = '';
    } else {
      hiddenTextarea.value = html;
    }
  });

  // Find the form and sync before submit
  const form = editorContainer.closest('form');
  if (form) {
    form.addEventListener('submit', () => {
      const html = quill.root.innerHTML;
      if (html === '<p><br></p>' || html === '<p></p>') {
        hiddenTextarea.value = '';
      } else {
        hiddenTextarea.value = html;
      }
    });
  }

  // Store quill instance for potential external access
  editorContainer.quillInstance = quill;
}

/**
 * Admin Category Management
 * Handles CRUD operations for categories in admin dashboard
 */
function setupAdminCategoryManagement() {
  const categorySection = document.querySelector('[data-admin-categories]');
  if (!categorySection) return;

  const modal = document.querySelector('[data-category-modal]');
  const modalTitle = document.querySelector('[data-category-modal-title]');
  const form = document.querySelector('[data-category-form]');
  const formId = document.querySelector('[data-category-form-id]');
  const formParentId = document.querySelector('[data-category-form-parent-id]');
  const formName = document.querySelector('[data-category-form-name]');
  const formParentSelect = document.querySelector('[data-category-form-parent-select]');
  const formDescription = document.querySelector('[data-category-form-description]');
  const parentGroup = document.querySelector('[data-category-parent-group]');
  const submitBtn = document.querySelector('[data-category-form-submit]');

  if (!modal || !form || !formId || !formName) return;

  let isSubmitting = false;

  // Open modal for adding root category
  categorySection.addEventListener('click', (event) => {
    const addRootBtn = event.target.closest('[data-category-add-root]');
    if (addRootBtn) {
      openModal({
        title: 'Thêm danh mục cha',
        mode: 'create',
        parentId: null,
        showParentSelect: false,
      });
    }
  });

  // Open modal for adding child category
  categorySection.addEventListener('click', (event) => {
    const addChildBtn = event.target.closest('[data-category-add-child]');
    if (addChildBtn) {
      const parentId = addChildBtn.dataset.parentId;
      const parentName = addChildBtn.dataset.parentName;
      openModal({
        title: `Thêm danh mục con vào "${parentName}"`,
        mode: 'create',
        parentId: parentId,
        showParentSelect: false,
      });
    }
  });

  // Open modal for editing category
  categorySection.addEventListener('click', (event) => {
    const editBtn = event.target.closest('[data-category-edit]');
    if (editBtn) {
      const categoryId = editBtn.dataset.categoryId;
      const categoryName = editBtn.dataset.categoryName;
      const categoryDescription = editBtn.dataset.categoryDescription || '';
      const parentId = editBtn.dataset.parentId || null;
      const isChild = !!parentId;

      openModal({
        title: `Sửa danh mục "${categoryName}"`,
        mode: 'edit',
        categoryId: categoryId,
        name: categoryName,
        description: categoryDescription,
        parentId: parentId,
        showParentSelect: isChild, // Only show parent select for child categories
      });
    }
  });

  // Delete category
  categorySection.addEventListener('click', async (event) => {
    const deleteBtn = event.target.closest('[data-category-delete]:not([disabled])');
    if (!deleteBtn) return;

    const categoryId = deleteBtn.dataset.categoryId;
    const categoryName = deleteBtn.dataset.categoryName;

    if (!confirm(`Bạn có chắc muốn xóa danh mục "${categoryName}"?`)) {
      return;
    }

    deleteBtn.disabled = true;
    deleteBtn.textContent = '⏳';

    try {
      const response = await fetch(`/account/admin/categories/${categoryId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Không thể xóa danh mục.');
      }

      // Remove the category from DOM
      const categoryItem = deleteBtn.closest('[data-category-item]');
      if (categoryItem) {
        categoryItem.remove();
      }

      // Show success message
      showToast(data.message || 'Đã xóa danh mục thành công.', 'success');

      // Update stats
      updateCategoryStats();
    } catch (error) {
      showToast(error.message || 'Có lỗi xảy ra khi xóa danh mục.', 'error');
      deleteBtn.disabled = false;
      deleteBtn.textContent = '🗑️';
    }
  });

  // Close modal
  modal.addEventListener('click', (event) => {
    if (event.target.matches('[data-category-modal-close]') || event.target === modal) {
      closeModal();
    }
  });

  // Handle form submit
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (isSubmitting) return;
    isSubmitting = true;

    const categoryId = formId.value;
    const isEdit = !!categoryId;
    const name = formName.value.trim();
    const description = formDescription?.value?.trim() || '';
    
    // Determine parent ID
    let parentId = null;
    if (formParentId.value) {
      parentId = formParentId.value;
    } else if (formParentSelect && !parentGroup?.hidden) {
      parentId = formParentSelect.value || null;
    }

    if (!name) {
      showToast('Vui lòng nhập tên danh mục.', 'error');
      isSubmitting = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Đang lưu...';

    try {
      const url = isEdit 
        ? `/account/admin/categories/${categoryId}` 
        : '/account/admin/categories';
      
      const method = isEdit ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({ name, parentId, description }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Không thể lưu danh mục.');
      }

      closeModal();
      showToast(data.message || (isEdit ? 'Đã cập nhật danh mục.' : 'Đã tạo danh mục mới.'), 'success');

      // Reload the page to show updated categories
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      showToast(error.message || 'Có lỗi xảy ra.', 'error');
    } finally {
      isSubmitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Lưu';
    }
  });

  // Escape key to close modal
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) {
      closeModal();
    }
  });

  function openModal(options = {}) {
    const {
      title = 'Thêm danh mục',
      mode = 'create',
      categoryId = '',
      name = '',
      description = '',
      parentId = null,
      showParentSelect = false,
    } = options;

    modalTitle.textContent = title;
    formId.value = categoryId;
    formName.value = name;
    if (formDescription) formDescription.value = description;

    // Handle parent selection
    if (parentId) {
      formParentId.value = parentId;
      if (formParentSelect) {
        formParentSelect.value = parentId;
      }
    } else {
      formParentId.value = '';
      if (formParentSelect) {
        formParentSelect.value = '';
      }
    }

    // Show/hide parent select dropdown
    if (parentGroup) {
      parentGroup.hidden = !showParentSelect;
    }

    // For editing a parent category, hide parent select
    if (mode === 'edit' && !parentId) {
      if (parentGroup) parentGroup.hidden = true;
    }

    // For adding child, hide parent select (already fixed)
    if (mode === 'create' && parentId) {
      if (parentGroup) parentGroup.hidden = true;
    }

    modal.hidden = false;
    formName.focus();
  }

  function closeModal() {
    modal.hidden = true;
    form.reset();
    formId.value = '';
    formParentId.value = '';
    if (formParentSelect) formParentSelect.value = '';
  }

  function updateCategoryStats() {
    // Update the category count in stats strip
    const categoryList = categorySection.querySelector('.admin-category-list');
    if (!categoryList) return;

    const parentItems = categoryList.querySelectorAll('.admin-category-item.is-parent');
    const childItems = categoryList.querySelectorAll('.admin-category-item.is-child');
    const totalCount = parentItems.length + childItems.length;

    // Find and update the stats strip
    const statsStrip = document.querySelector('.stats-strip');
    if (statsStrip) {
      const categoryStatDiv = Array.from(statsStrip.children).find(div => 
        div.querySelector('span')?.textContent?.includes('Danh mục')
      );
      if (categoryStatDiv) {
        const strong = categoryStatDiv.querySelector('strong');
        if (strong) {
          strong.textContent = totalCount;
        }
      }
    }
  }

  function showToast(message, type = 'info') {
    // Simple toast notification
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('is-visible');
    });

    setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

/**
 * Shipment Proof Upload - Handles file upload preview and drag-drop for seller shipment proof
 */
function setupShipmentProofUpload() {
  const uploadZone = document.getElementById('shipmentProofUploadZone');
  const fileInput = document.getElementById('shipmentProofInput');
  const previewContainer = document.getElementById('shipmentProofPreview');
  
  if (!uploadZone || !fileInput || !previewContainer) return;
  
  // Track selected files
  let selectedFiles = [];
  const MAX_FILES = 5;
  
  // Handle file selection
  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
  });
  
  // Drag and drop handlers
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.add('is-dragover');
  });
  
  uploadZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove('is-dragover');
  });
  
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove('is-dragover');
    
    const files = e.dataTransfer.files;
    handleFiles(files);
  });
  
  // Click anywhere on zone to trigger file input
  uploadZone.addEventListener('click', (e) => {
    if (e.target === fileInput || e.target.closest('.upload-trigger')) return;
    fileInput.click();
  });
  
  function handleFiles(fileList) {
    const files = Array.from(fileList);
    
    // Filter only images
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length === 0) {
      showToast('Vui lòng chọn file ảnh (JPG, PNG, ...)', 'error');
      return;
    }
    
    // Check max files limit
    const remainingSlots = MAX_FILES - selectedFiles.length;
    if (remainingSlots <= 0) {
      showToast(`Đã đạt giới hạn ${MAX_FILES} ảnh`, 'error');
      return;
    }
    
    const filesToAdd = imageFiles.slice(0, remainingSlots);
    if (filesToAdd.length < imageFiles.length) {
      showToast(`Chỉ thêm được ${filesToAdd.length} ảnh (tối đa ${MAX_FILES})`, 'info');
    }
    
    filesToAdd.forEach(file => {
      selectedFiles.push(file);
      createPreview(file, selectedFiles.length - 1);
    });
    
    updateFileInput();
  }
  
  function createPreview(file, index) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const previewItem = document.createElement('div');
      previewItem.className = 'preview-item';
      previewItem.dataset.index = index;
      previewItem.innerHTML = `
        <img src="${e.target.result}" alt="Preview ${index + 1}" />
        <button type="button" class="remove-btn" title="Xóa ảnh">&times;</button>
      `;
      
      previewItem.querySelector('.remove-btn').addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeFile(index);
      });
      
      previewContainer.appendChild(previewItem);
    };
    reader.readAsDataURL(file);
  }
  
  function removeFile(index) {
    selectedFiles = selectedFiles.filter((_, i) => i !== index);
    renderPreviews();
    updateFileInput();
  }
  
  function renderPreviews() {
    previewContainer.innerHTML = '';
    selectedFiles.forEach((file, index) => {
      createPreview(file, index);
    });
  }
  
  function updateFileInput() {
    // Create new DataTransfer to update file input
    const dt = new DataTransfer();
    selectedFiles.forEach(file => dt.items.add(file));
    fileInput.files = dt.files;
  }
  
  function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('is-visible');
    });

    setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

/**
 * Client-side Form Validation
 * Provides real-time validation feedback for forms
 */
function setupFormValidation() {
  // Validation rules
  const validators = {
    required: (value) => {
      const trimmed = String(value || '').trim();
      return trimmed.length > 0 ? null : 'Trường này là bắt buộc';
    },
    email: (value) => {
      if (!value) return null;
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(value) ? null : 'Email không hợp lệ';
    },
    minLength: (value, min) => {
      if (!value) return null;
      return value.length >= min ? null : `Tối thiểu ${min} ký tự`;
    },
    maxLength: (value, max) => {
      if (!value) return null;
      return value.length <= max ? null : `Tối đa ${max} ký tự`;
    },
    password: (value) => {
      if (!value) return null;
      if (value.length < 6) return 'Mật khẩu phải có ít nhất 6 ký tự';
      return null;
    },
    confirmPassword: (value, form) => {
      if (!value) return null;
      const passwordField = form.querySelector('[name="password"], [name="newPassword"]');
      if (passwordField && value !== passwordField.value) {
        return 'Mật khẩu xác nhận không khớp';
      }
      return null;
    },
    minValue: (value, min) => {
      if (!value) return null;
      const numValue = parseCurrency(value);
      return numValue >= min ? null : `Giá trị tối thiểu ${formatNumber(min)}`;
    },
    url: (value) => {
      if (!value) return null;
      try {
        new URL(value);
        return null;
      } catch {
        return 'URL không hợp lệ';
      }
    },
    futureDate: (value) => {
      if (!value) return null;
      const date = new Date(value);
      const now = new Date();
      return date > now ? null : 'Thời gian phải sau hiện tại';
    },
    dateAfter: (value, form, otherFieldName) => {
      if (!value) return null;
      const otherField = form.querySelector(`[name="${otherFieldName}"]`);
      if (!otherField || !otherField.value) return null;
      const date = new Date(value);
      const otherDate = new Date(otherField.value);
      return date > otherDate ? null : 'Thời gian kết thúc phải sau thời gian bắt đầu';
    }
  };

  // Parse currency string to number
  function parseCurrency(value) {
    if (typeof value === 'number') return value;
    const cleaned = String(value).replace(/[^\d]/g, '');
    return parseInt(cleaned, 10) || 0;
  }

  // Format number with thousand separators
  function formatNumber(num) {
    return new Intl.NumberFormat('vi-VN').format(num);
  }

  // Show field error
  function showFieldError(field, message) {
    const formField = field.closest('.form-field');
    if (!formField) return;
    
    formField.classList.add('has-error');
    
    let errorSpan = formField.querySelector('.field-error');
    if (!errorSpan) {
      errorSpan = document.createElement('span');
      errorSpan.className = 'field-error';
      formField.appendChild(errorSpan);
    }
    errorSpan.textContent = message;
  }

  // Clear field error
  function clearFieldError(field) {
    const formField = field.closest('.form-field');
    if (!formField) return;
    
    formField.classList.remove('has-error');
    const errorSpan = formField.querySelector('.field-error');
    if (errorSpan) {
      errorSpan.textContent = '';
    }
  }

  // Validate a single field
  function validateField(field, form) {
    const value = field.value;
    const name = field.name;
    let error = null;

    // Required check
    if (field.hasAttribute('required')) {
      error = validators.required(value);
      if (error) {
        showFieldError(field, error);
        return false;
      }
    }

    // Skip further validation if empty and not required
    if (!value) {
      clearFieldError(field);
      return true;
    }

    // Type-specific validation
    if (field.type === 'email') {
      error = validators.email(value);
    } else if (field.type === 'password') {
      if (name === 'confirmPassword') {
        error = validators.confirmPassword(value, form);
      } else if (name !== 'currentPassword') {
        error = validators.password(value);
      }
    } else if (field.type === 'url') {
      error = validators.url(value);
    } else if (field.type === 'datetime-local') {
      if (name === 'startDate') {
        error = validators.futureDate(value);
      } else if (name === 'endDate') {
        error = validators.dateAfter(value, form, 'startDate');
      }
    }

    // Currency fields with min value
    if (field.classList.contains('currency-input') && field.dataset.min) {
      const minError = validators.minValue(value, parseInt(field.dataset.min, 10));
      if (minError) error = minError;
    }

    // Min/max length from attributes
    if (field.minLength > 0) {
      const minLenError = validators.minLength(value, field.minLength);
      if (minLenError) error = minLenError;
    }
    if (field.maxLength > 0 && field.maxLength < 524288) {
      const maxLenError = validators.maxLength(value, field.maxLength);
      if (maxLenError) error = maxLenError;
    }

    // Custom data-* validation rules
    if (field.dataset.minLength) {
      const minLenError = validators.minLength(value, parseInt(field.dataset.minLength, 10));
      if (minLenError) error = minLenError;
    }
    if (field.dataset.maxLength) {
      const maxLenError = validators.maxLength(value, parseInt(field.dataset.maxLength, 10));
      if (maxLenError) error = maxLenError;
    }

    if (error) {
      showFieldError(field, error);
      return false;
    }

    clearFieldError(field);
    return true;
  }

  // Validate entire form
  function validateForm(form) {
    const fields = form.querySelectorAll('input, textarea, select');
    let isValid = true;
    let firstErrorField = null;

    fields.forEach(field => {
      if (field.type === 'hidden' || field.disabled) return;
      if (!validateField(field, form)) {
        isValid = false;
        if (!firstErrorField) firstErrorField = field;
      }
    });

    if (firstErrorField) {
      firstErrorField.focus();
      firstErrorField.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    return isValid;
  }

  // Setup validation for all forms
  const forms = document.querySelectorAll('form:not([data-no-validate])');
  
  forms.forEach(form => {
    // Add novalidate to prevent browser default validation UI
    form.setAttribute('novalidate', '');
    
    // Real-time validation on blur
    form.addEventListener('blur', (e) => {
      const field = e.target;
      if (field.matches('input, textarea, select')) {
        validateField(field, form);
      }
    }, true);

    // Clear error on input
    form.addEventListener('input', (e) => {
      const field = e.target;
      if (field.matches('input, textarea, select')) {
        const formField = field.closest('.form-field');
        if (formField && formField.classList.contains('has-error')) {
          // Revalidate on input to clear error if fixed
          validateField(field, form);
        }
      }
    });

    // Validate on submit
    form.addEventListener('submit', (e) => {
      if (!validateForm(form)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
  });

  // Special handling for password confirmation - revalidate when password changes
  document.addEventListener('input', (e) => {
    if (e.target.matches('[name="password"], [name="newPassword"]')) {
      const form = e.target.closest('form');
      if (!form) return;
      const confirmField = form.querySelector('[name="confirmPassword"]');
      if (confirmField && confirmField.value) {
        validateField(confirmField, form);
      }
    }
  });
}
