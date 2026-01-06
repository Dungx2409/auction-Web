const express = require('express');
const dayjs = require('dayjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const dataService = require('../../services/dataService');
const mailer = require('../../services/mailer');
const { buildAccountContext, resolveRoles } = require('./accountMiddleware');
const { renderAccountPage } = require('./renderAccountPage');

const router = express.Router();

// Multer configuration for product images
const storage = multer.diskStorage({
	destination: function (req, file, cb) {
		// Temporary destination, will be moved after product creation
		const tempDir = path.join(__dirname, '../../uploads/products/temp');
		if (!fs.existsSync(tempDir)) {
			fs.mkdirSync(tempDir, { recursive: true });
		}
		cb(null, tempDir);
	},
	filename: function (req, file, cb) {
		const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
		const ext = path.extname(file.originalname);
		cb(null, uniqueSuffix + ext);
	}
});

const fileFilter = (req, file, cb) => {
	const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
	if (allowedTypes.includes(file.mimetype)) {
		cb(null, true);
	} else {
		cb(new Error('Chỉ chấp nhận file ảnh (JPEG, PNG, GIF, WEBP)'), false);
	}
};

const upload = multer({
	storage: storage,
	fileFilter: fileFilter,
	limits: {
		fileSize: 5 * 1024 * 1024, // 5MB per file
		files: 10 // Maximum 10 files
	}
});

const MIN_TITLE_LENGTH = 8;
const MAX_TITLE_LENGTH = 120;
const MIN_SHORT_DESCRIPTION_LENGTH = 30;
const MAX_SHORT_DESCRIPTION_LENGTH = 240;
const MIN_FULL_DESCRIPTION_LENGTH = 80;
const MIN_AUCTION_DURATION_MINUTES = 60;
const MAX_AUCTION_DURATION_DAYS = 30;
const MIN_PRICE_VALUE = 1000;

function isValidUrl(value) {
	if (!value) return true;
	try {
		new URL(value);
		return true;
	} catch (error) {
		return false;
	}
}

function sanitizeProductText(value = '') {
	return value.trim();
}

function stripHtml(value = '') {
	return value.replace(/<[^>]*>/g, ' ');
}

/**
 * Sanitize HTML from Quill editor - allow only safe tags
 * @param {string} html 
 * @returns {string}
 */
function sanitizeHtml(html = '') {
	if (!html || typeof html !== 'string') return '';
	
	// Allowed tags from Quill
	const allowedTags = [
		'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
		'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
		'ul', 'ol', 'li',
		'blockquote', 'pre', 'code',
		'a', 'span'
	];
	
	// Allowed attributes
	const allowedAttrs = {
		'a': ['href', 'target', 'rel'],
		'span': ['style'],
		'p': ['class'],
		'li': ['class']
	};
	
	// Allowed style properties (for color/background from Quill)
	const allowedStyles = ['color', 'background-color', 'text-align'];
	
	// Remove script tags and event handlers completely
	let sanitized = html
		.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
		.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
		.replace(/on\w+\s*=\s*[^\s>]*/gi, '')
		.replace(/javascript:/gi, '');
	
	// Process tags - keep only allowed ones
	sanitized = sanitized.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (match, tagName) => {
		const tag = tagName.toLowerCase();
		
		if (!allowedTags.includes(tag)) {
			return ''; // Remove disallowed tags
		}
		
		// Check if it's a closing tag
		if (match.startsWith('</')) {
			return `</${tag}>`;
		}
		
		// Extract and filter attributes
		const attrMatch = match.match(/<[a-z][a-z0-9]*\s+([^>]*)>/i);
		if (!attrMatch || !allowedAttrs[tag]) {
			// Self-closing tags like <br>
			if (tag === 'br') return '<br>';
			return `<${tag}>`;
		}
		
		const attrString = attrMatch[1];
		const validAttrs = [];
		
		// Parse and filter attributes
		const attrRegex = /([a-z-]+)\s*=\s*["']([^"']*)["']/gi;
		let attrResult;
		while ((attrResult = attrRegex.exec(attrString)) !== null) {
			const attrName = attrResult[1].toLowerCase();
			let attrValue = attrResult[2];
			
			if (allowedAttrs[tag] && allowedAttrs[tag].includes(attrName)) {
				// Special handling for href - prevent javascript:
				if (attrName === 'href') {
					if (attrValue.toLowerCase().startsWith('javascript:')) {
						continue;
					}
					// Add rel="noopener noreferrer" for external links
					validAttrs.push(`href="${attrValue}"`);
					validAttrs.push('target="_blank"');
					validAttrs.push('rel="noopener noreferrer"');
				} else if (attrName === 'style') {
					// Filter style properties
					const styleProps = attrValue.split(';').filter(prop => {
						const propName = prop.split(':')[0]?.trim().toLowerCase();
						return allowedStyles.includes(propName);
					}).join(';');
					if (styleProps) {
						validAttrs.push(`style="${styleProps}"`);
					}
				} else {
					validAttrs.push(`${attrName}="${attrValue}"`);
				}
			}
		}
		
		if (validAttrs.length > 0) {
			return `<${tag} ${validAttrs.join(' ')}>`;
		}
		return `<${tag}>`;
	});
	
	return sanitized.trim();
}

function normalizeWhitespace(value = '') {
	return value.replace(/\s+/g, ' ').trim();
}

function parseGalleryUrls(value = '') {
	return value
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

function validateProductInput(body = {}, files = []) {
	const errors = {};
	const rawProductId = body.productId ? Number(body.productId) : null;
	const productId = Number.isFinite(rawProductId) && rawProductId > 0 ? rawProductId : null;
	const isEditing = Boolean(productId);
	
	// Parse image URLs from textarea
	const imageUrls = parseGalleryUrls(body.imageUrls || '').filter(url => {
		try {
			new URL(url);
			return url.startsWith('http://') || url.startsWith('https://');
		} catch {
			return false;
		}
	});
	
	const formValues = {
		title: sanitizeProductText(body.title),
		shortDescription: sanitizeProductText(body.shortDescription || body.summary || ''),
		fullDescription: sanitizeHtml(body.fullDescription || ''),
		categoryId: body.categoryId ? String(body.categoryId) : '',
		startPrice: body.startPrice ?? '',
		stepPrice: body.stepPrice ?? '',
		currentPrice: body.startPrice ?? '',
		buyNowPrice: body.buyNowPrice ?? '',
		startDate: body.startDate || '',
		endDate: body.endDate || '',
		autoExtend: body.autoExtend === 'on' || body.autoExtend === 'true' || body.autoExtend === true,
		productId: productId ? String(productId) : '',
		imageUrls: body.imageUrls || '',
	};

	if (!formValues.title) {
		errors.title = 'Vui lòng nhập tên sản phẩm.';
	} else if (formValues.title.length < MIN_TITLE_LENGTH || formValues.title.length > MAX_TITLE_LENGTH) {
		errors.title = `Tên sản phẩm phải từ ${MIN_TITLE_LENGTH} đến ${MAX_TITLE_LENGTH} ký tự.`;
	}

	// Auto-generate shortDescription from fullDescription if not provided
	if (!formValues.shortDescription && formValues.fullDescription) {
		const plainText = normalizeWhitespace(stripHtml(formValues.fullDescription));
		formValues.shortDescription = plainText.slice(0, MAX_SHORT_DESCRIPTION_LENGTH);
	}

	if (!formValues.shortDescription) {
		errors.shortDescription = 'Hãy mô tả ngắn gọn sản phẩm của bạn.';
	} else {
		const shortDescLength = formValues.shortDescription.length;
		if (shortDescLength < MIN_SHORT_DESCRIPTION_LENGTH) {
			errors.shortDescription = `Mô tả ngắn cần ít nhất ${MIN_SHORT_DESCRIPTION_LENGTH} ký tự (hiện tại: ${shortDescLength} ký tự).`;
		}
	}

	const plainFullDescription = normalizeWhitespace(stripHtml(formValues.fullDescription));
	if (!plainFullDescription) {
		errors.fullDescription = 'Vui lòng nhập mô tả chi tiết sản phẩm.';
	} else if (plainFullDescription.length < MIN_FULL_DESCRIPTION_LENGTH) {
		errors.fullDescription = `Mô tả chi tiết cần tối thiểu ${MIN_FULL_DESCRIPTION_LENGTH} ký tự.`;
	}

	const categoryId = Number(formValues.categoryId);
	if (!categoryId) {
		errors.categoryId = 'Vui lòng chọn danh mục.';
	}

	const startPrice = Number(formValues.startPrice);
	if (!Number.isFinite(startPrice) || startPrice <= 0) {
		errors.startPrice = 'Giá khởi điểm phải lớn hơn 0.';
	} else if (startPrice < MIN_PRICE_VALUE) {
		errors.startPrice = `Giá khởi điểm tối thiểu là ${MIN_PRICE_VALUE.toLocaleString('vi-VN')} đ.`;
	}

	const stepPrice = Number(formValues.stepPrice);
	if (!Number.isFinite(stepPrice) || stepPrice <= 0) {
		errors.stepPrice = 'Bước giá phải lớn hơn 0.';
	} else if (stepPrice < MIN_PRICE_VALUE) {
		errors.stepPrice = `Bước giá tối thiểu là ${MIN_PRICE_VALUE.toLocaleString('vi-VN')} đ.`;
	} else if (Number.isFinite(startPrice) && stepPrice >= startPrice) {
		errors.stepPrice = 'Bước giá phải nhỏ hơn giá khởi điểm.';
	}

	let buyNowPrice = null;
	if (formValues.buyNowPrice !== '') {
		const parsed = Number(formValues.buyNowPrice);
		if (!Number.isFinite(parsed) || parsed <= 0) {
			errors.buyNowPrice = 'Giá mua ngay phải lớn hơn 0.';
		} else if (Number.isFinite(startPrice) && parsed <= startPrice) {
			errors.buyNowPrice = 'Giá mua ngay phải cao hơn giá khởi điểm.';
		} else if (Number.isFinite(startPrice) && Number.isFinite(stepPrice) && parsed <= startPrice + stepPrice) {
			errors.buyNowPrice = 'Giá mua ngay phải cao hơn ít nhất một bước giá so với giá khởi điểm.';
		} else {
			buyNowPrice = parsed;
		}
	}

	const now = dayjs();
	let startDate = null;
	// When editing, startDate is fixed and not required from form
	if (!isEditing) {
		if (!formValues.startDate) {
			errors.startDate = 'Vui lòng chọn thời gian bắt đầu.';
		} else {
			const parsed = dayjs(formValues.startDate);
			if (!parsed.isValid()) {
				errors.startDate = 'Thời gian bắt đầu không hợp lệ.';
			} else {
				startDate = parsed;
				formValues.startDate = parsed.format('YYYY-MM-DDTHH:mm');
				if (startDate.isBefore(now.add(15, 'minute'))) {
					errors.startDate = 'Thời gian bắt đầu phải sau thời điểm hiện tại ít nhất 15 phút.';
				}
			}
		}
	} else if (formValues.startDate) {
		// For editing, just parse the startDate for display purposes but don't validate
		const parsed = dayjs(formValues.startDate);
		if (parsed.isValid()) {
			startDate = parsed;
			formValues.startDate = parsed.format('YYYY-MM-DDTHH:mm');
		}
	}

	let endDate = null;
	if (!formValues.endDate) {
		errors.endDate = 'Vui lòng chọn thời gian kết thúc.';
	} else {
		const parsed = dayjs(formValues.endDate);
		if (!parsed.isValid()) {
			errors.endDate = 'Thời gian kết thúc không hợp lệ.';
		} else if (startDate && parsed.valueOf() <= startDate.valueOf()) {
			errors.endDate = 'Thời gian kết thúc phải sau thời gian bắt đầu.';
		} else {
			endDate = parsed;
			formValues.endDate = parsed.format('YYYY-MM-DDTHH:mm');
			if (startDate) {
				const durationMinutes = endDate.diff(startDate, 'minute');
				if (durationMinutes < MIN_AUCTION_DURATION_MINUTES) {
					errors.endDate = `Phiên đấu giá cần kéo dài ít nhất ${MIN_AUCTION_DURATION_MINUTES / 60} giờ.`;
				}
				const durationDays = endDate.diff(startDate, 'day', true);
				if (!errors.endDate && durationDays > MAX_AUCTION_DURATION_DAYS) {
					errors.endDate = `Phiên đấu giá không được vượt quá ${MAX_AUCTION_DURATION_DAYS} ngày.`;
				}
			}
		}
	}

	// Validate product images (minimum 3 images required - from file upload OR URLs)
	const totalImages = (files?.length || 0) + imageUrls.length;
	if (!isEditing) {
		if (totalImages < 3) {
			errors.productImages = `Vui lòng cung cấp ít nhất 3 ảnh cho sản phẩm (hiện tại: ${totalImages} ảnh). Bạn có thể tải ảnh từ máy hoặc nhập URL ảnh.`;
		}
	}

	const values = {
		productId,
		title: formValues.title,
		shortDescription: formValues.shortDescription,
		fullDescription: formValues.fullDescription,
		categoryId,
		startPrice,
		currentPrice: formValues.currentPrice ?? '',
		stepPrice,
		buyNowPrice,
		startDate: startDate ? startDate.toDate() : null,
		endDate: endDate ? endDate.toDate() : null,
		autoExtend: formValues.autoExtend,
		uploadedFiles: files || [],
		imageUrls: imageUrls,
	};

	return { errors, values, formValues };
}

router.get('/', (req, res, next) => {
	renderAccountPage(req, res, next, { section: 'products' });
});

// Helper function to move files to final destination with proper naming
async function moveFilesToProductFolder(files, sellerId, productId) {
	const productDir = path.join(__dirname, '../../uploads/products', `seller_${sellerId}`, `product_${productId}`);
	
	if (!fs.existsSync(productDir)) {
		fs.mkdirSync(productDir, { recursive: true });
	}

	const imageUrls = [];
	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		const ext = path.extname(file.originalname).toLowerCase() || '.png';
		
		// First image is main, rest are picture_1, picture_2, etc.
		let newFilename;
		if (i === 0) {
			newFilename = `main${ext}`;
		} else {
			newFilename = `picture_${i}${ext}`;
		}
		
		const newPath = path.join(productDir, newFilename);
		
		// If file already exists, remove it first (for updates)
		if (fs.existsSync(newPath)) {
			fs.unlinkSync(newPath);
		}
		
		fs.renameSync(file.path, newPath);
		imageUrls.push(`/uploads/products/seller_${sellerId}/product_${productId}/${newFilename}`);
	}
	
	return imageUrls;
}

// Helper function to clean up temp files on error
function cleanupTempFiles(files) {
	if (!files || files.length === 0) return;
	for (const file of files) {
		try {
			if (fs.existsSync(file.path)) {
				fs.unlinkSync(file.path);
			}
		} catch (err) {
			console.error('Error cleaning up temp file:', err);
		}
	}
}

// Middleware wrapper để xử lý lỗi upload và hiển thị thông báo
function handleProductUpload(req, res, next) {
	const uploader = upload.array('productImages', 10);
	uploader(req, res, async (err) => {
		if (err) {
			console.error('[seller] product image upload error:', err);
			
			// Xác định loại lỗi và thông báo phù hợp
			let errorMessage = 'Có lỗi xảy ra khi tải ảnh lên.';
			
			if (err.code === 'LIMIT_FILE_SIZE') {
				errorMessage = 'Kích thước file quá lớn. Mỗi ảnh tối đa 5MB.';
			} else if (err.code === 'LIMIT_FILE_COUNT') {
				errorMessage = 'Số lượng ảnh vượt quá giới hạn (tối đa 10 ảnh).';
			} else if (err.message && err.message.includes('Chỉ chấp nhận file ảnh')) {
				errorMessage = err.message;
			} else if (err instanceof multer.MulterError) {
				errorMessage = `Lỗi upload: ${err.message}`;
			}
			
			// Hiển thị lỗi cho người dùng
			const user = req.currentUser;
			if (!user?.id) {
				return res.redirect('/auth/login');
			}
			
			const { buildAccountContext } = require('./accountMiddleware');
			const context = await buildAccountContext(user, {
				seller: {
					productForm: req.body || {},
					productErrors: { productImages: errorMessage },
					productFlash: {
						type: 'error',
						message: errorMessage,
					},
				},
				activeSection: 'products',
			});
			return res.status(400).render('account/overview', context);
		}
		next();
	});
}

router.post('/', handleProductUpload, async (req, res, next) => {
	try {
		const user = req.currentUser;
		if (!user?.id) {
			cleanupTempFiles(req.files);
			return res.redirect('/auth/login');
		}

		const roles = resolveRoles(user);
		if (!roles.includes('seller')) {
			cleanupTempFiles(req.files);
			const context = await buildAccountContext(user, {
				seller: {
					productFlash: {
						type: 'error',
						message: 'Chỉ người bán mới được phép đăng sản phẩm.',
					},
				},
				activeSection: 'products',
			});
			return res.status(403).render('account/overview', context);
		}
		const { errors, values, formValues } = validateProductInput(req.body || {}, req.files || []);
		const isEditing = Boolean(values.productId);
		if (Object.keys(errors).length > 0) {
			cleanupTempFiles(req.files);
			const context = await buildAccountContext(user, {
				seller: {
					productForm: formValues,
					productErrors: errors,
					editingProductId: isEditing ? values.productId : null,
				},
				activeSection: 'products',
			});
			return res.status(400).render('account/overview', context);
		}

		if (isEditing) {
			// For editing, handle images if new ones are uploaded or new URLs provided
			let newImageUrls = null;
			
			// Check for uploaded files
			if (req.files && req.files.length > 0) {
				newImageUrls = await moveFilesToProductFolder(req.files, user.id, values.productId);
			}
			// Check for URL images from form (only if no files uploaded)
			else if (values.imageUrls && values.imageUrls.length > 0) {
				newImageUrls = values.imageUrls;
			}
			
			// Build update payload - only include imageUrl if new images are provided
			const updatePayload = {
				productId: values.productId,
				sellerId: user.id,
				categoryId: values.categoryId,
				title: values.title,
				shortDescription: values.shortDescription,
				fullDescription: values.fullDescription,
				startPrice: values.startPrice,
				stepPrice: values.stepPrice,
				buyNowPrice: values.buyNowPrice,
				// startDate is not updated - it should remain fixed after product creation
				endDate: values.endDate,
				autoExtend: values.autoExtend,
			};
			
			// Only include image fields if new images were provided
			if (newImageUrls && newImageUrls.length > 0) {
				updatePayload.imageUrl = newImageUrls[0];
				updatePayload.galleryUrls = newImageUrls.slice(1);
			}
			
			await dataService.updateProduct(updatePayload);

			// Send email notification to watchers and bidders about the description update
			const [watchers, bidders] = await Promise.all([
				dataService.getWatchersForProduct(values.productId),
				dataService.getBiddersForProduct(values.productId),
			]);

			// Merge watchers and bidders, removing duplicates by email
			const recipientMap = new Map();
			for (const watcher of watchers) {
				if (watcher.email) {
					recipientMap.set(watcher.email.toLowerCase(), watcher);
				}
			}
			for (const bidder of bidders) {
				if (bidder.email && !recipientMap.has(bidder.email.toLowerCase())) {
					recipientMap.set(bidder.email.toLowerCase(), bidder);
				}
			}
			const recipients = Array.from(recipientMap.values());

			if (recipients.length > 0) {
				const host = req.get('host') || 'localhost:3000';
				const protocol = req.protocol || 'http';
				const productUrl = `${protocol}://${host}/products/${values.productId}`;
				const sellerName = user.full_name || user.fullName || user.name || 'Người bán';

				// Send emails in parallel (non-blocking)
				Promise.allSettled(
					recipients.map((recipient) =>
						mailer.sendProductDescriptionUpdateEmail({
							to: recipient.email,
							watcherName: recipient.name,
							sellerName,
							productTitle: values.title,
							productUrl,
						})
					)
				).then((results) => {
					const sent = results.filter((r) => r.status === 'fulfilled' && r.value?.success).length;
					console.info(`[mailer] Đã gửi ${sent}/${recipients.length} email thông báo cập nhật mô tả sản phẩm #${values.productId} (${watchers.length} watchers, ${bidders.length} bidders)`);
				}).catch((err) => {
					console.error('[mailer] Lỗi khi gửi email thông báo cập nhật mô tả:', err);
				});
			}
		} else {
			// Create product first to get the ID
			const newProduct = await dataService.createProduct({
				sellerId: user.id,
				categoryId: values.categoryId,
				title: values.title,
				shortDescription: values.shortDescription,
				fullDescription: values.fullDescription,
				startPrice: values.startPrice,
				stepPrice: values.stepPrice,
				buyNowPrice: values.buyNowPrice,
				startDate: values.startDate,
				endDate: values.endDate,
				autoExtend: values.autoExtend,
				imageUrl: null,
				galleryUrls: [],
			});

			// Combine uploaded files and URL images
			let allImageUrls = [];
			
			// First, handle uploaded files
			if (req.files && req.files.length > 0) {
				const uploadedImageUrls = await moveFilesToProductFolder(req.files, user.id, newProduct.id);
				allImageUrls = allImageUrls.concat(uploadedImageUrls);
			}
			
			// Then, add URL images
			if (values.imageUrls && values.imageUrls.length > 0) {
				allImageUrls = allImageUrls.concat(values.imageUrls);
			}
			
			const imageUrls = allImageUrls;
			
			// Update product with image URLs
			await dataService.updateProduct({
				productId: newProduct.id,
				sellerId: user.id,
				imageUrl: imageUrls[0],
				galleryUrls: imageUrls.slice(1),
			});
		}

		const context = await buildAccountContext(user, {
			seller: {
				productFlash: {
					type: 'success',
					message: isEditing
						? 'Cập nhật sản phẩm thành công! Thông tin mới đã được áp dụng.'
						: 'Đăng sản phẩm thành công! Sản phẩm của bạn đã sẵn sàng hiển thị.',
				},
			},
			activeSection: 'products',
		});
		res.render('account/overview', context);
	} catch (error) {
		cleanupTempFiles(req.files);
		next(error);
	}
});

router.post('/:productId/bid-requests/:requestId', async (req, res, next) => {
	try {
		const user = req.currentUser;
		if (!user?.id) {
			return res.redirect('/auth/login');
		}
		if (!resolveRoles(user).includes('seller')) {
			return res.status(403).render('403', { title: 'Bạn không có quyền thực hiện thao tác này.' });
		}

		const productId = Number(req.params.productId);
		const requestId = Number(req.params.requestId);
		if (!Number.isFinite(productId) || productId <= 0 || !Number.isFinite(requestId) || requestId <= 0) {
			return renderAccountPage(req, res, next, {
				section: 'products',
				extras: {
					seller: {
						productFlash: {
							type: 'error',
							message: 'Thông tin yêu cầu không hợp lệ.',
						},
					},
				},
			});
		}

		const action = req.body?.action === 'approve' ? 'approve' : 'reject';
		const note = req.body?.note || '';
		let flash = null;

		try {
			const result = await dataService.updateBidRequestStatus({
				requestId,
				sellerId: user.id,
				action,
				note,
			});

			// Gửi email thông báo cho bidder
			if (result.bidderEmail) {
				const host = req.get('host') || 'localhost:3000';
				const protocol = req.protocol || 'http';
				const productUrl = `${protocol}://${host}/products/${result.productId}`;

				mailer.sendBidRequestResponseEmail({
					to: result.bidderEmail,
					bidderName: result.bidderName,
					productTitle: result.productTitle,
					productUrl,
					approved: result.approved,
					sellerNote: result.sellerNote,
				}).catch((err) => {
					console.error('[mailer] Không thể gửi email phản hồi yêu cầu đấu giá:', err);
				});
			}

			flash = {
				type: action === 'approve' ? 'success' : 'warning',
				message:
					action === 'approve'
						? 'Đã chấp thuận yêu cầu tham gia đấu giá. Bidder có thể đặt giá ngay.'
						: 'Đã từ chối yêu cầu tham gia đấu giá này.',
			};
		} catch (error) {
			console.error('Không thể cập nhật yêu cầu đấu giá:', error);
			flash = {
				type: 'error',
				message: 'Không thể cập nhật yêu cầu ngay lúc này. Vui lòng thử lại.',
			};
		}

		return renderAccountPage(req, res, next, {
			section: 'products',
			extras: {
				seller: {
					productFlash: flash,
				},
			},
		});
	} catch (error) {
		next(error);
	}
});

router.get('/:id/delete', async (req, res, next) => {
	try {
		const productId = req.params.id;
		const user = req.currentUser;
		if (!user?.id) {
			return res.redirect('/auth/login');
		}
		if (!resolveRoles(user).includes('seller')) {
			return res.status(403).render('403', { title: 'Bạn không có quyền xóa sản phẩm.' });
		}
		const removed = await dataService.removeProduct(productId);
		if (!removed) {
			return res.status(404).render('404', { title: 'Sản phẩm không tồn tại hoặc đã được xóa.' });
		}
		return res.redirect('/account/products?tab=sales');
	} catch (error) {
		next(error);
	}
});

router.get('/:id/edit', async (req, res, next) => {
	try {
		const productId = req.params.id;
		const user = req.currentUser;
		if (!user?.id) {
			return res.redirect('/auth/login');
		}
		const product = await dataService.getProductById(productId, { includeBannedSeller: true });
		if (!product) {
			return res.status(404).render('404', { title: 'Sản phẩm không tồn tại' });
		}
		if (String(product.seller?.id) !== String(user.id)) {
			return res.status(403).render('403', { title: 'Bạn không có quyền chỉnh sửa sản phẩm này.' });
		}

		const productForm = {
			productId: product.id,
			title: product.title,
			shortDescription: product.summary,
			fullDescription: product.description,
			categoryId: product.categoryId ? String(product.categoryId) : '',
			startPrice: product.startPrice,
			stepPrice: product.bidStep,
			buyNowPrice: product.buyNowPrice ?? '',
			startDate: product.startDate ? dayjs(product.startDate).format('YYYY-MM-DDTHH:mm') : '',
			endDate: product.endDate ? dayjs(product.endDate).format('YYYY-MM-DDTHH:mm') : '',
			existingImages: product.images || [],
			autoExtend: product.autoExtend,
		};

		return renderAccountPage(req, res, next, {
			section: 'products',
			extras: {
				seller: {
					productForm,
					editingProductId: product.id,
					editingProductTitle: product.title,
					productFlash: {
						type: 'info',
						message: 'Đang ở chế độ chỉnh sửa sản phẩm. Sau khi lưu, biểu mẫu sẽ quay về chế độ đăng mới.',
					},
				},
			},
		});
	} catch (error) {
		next(error);
	}
});

module.exports = router;
