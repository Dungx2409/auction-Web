const express = require('express');
const bcrypt = require('bcryptjs');

const userStore = require('../../services/userStore');
const { buildAccountContext } = require('./accountMiddleware');
const { renderAccountPage } = require('./renderAccountPage');

const router = express.Router();

function validateProfileInput({ name = '', address = '' }) {
	const errors = {};
	const trimmedName = name.trim();
	const trimmedAddress = address.trim();

	if (!trimmedName) {
		errors.name = 'Vui lòng nhập họ tên.';
	}
	if (!trimmedAddress) {
		errors.address = 'Vui lòng nhập địa chỉ.';
	}

	return { errors, values: { name: trimmedName, address: trimmedAddress } };
}

function validatePasswordInput({ currentPassword = '', newPassword = '', confirmPassword = '' }) {
	const errors = {};

	if (!currentPassword.trim()) {
		errors.currentPassword = 'Vui lòng nhập mật khẩu hiện tại.';
	}
	if (!newPassword.trim()) {
		errors.newPassword = 'Vui lòng nhập mật khẩu mới.';
	} else if (newPassword.length < 6) {
		errors.newPassword = 'Mật khẩu mới cần ít nhất 6 ký tự.';
	}
	if (!confirmPassword.trim()) {
		errors.confirmPassword = 'Vui lòng xác nhận mật khẩu mới.';
	} else if (newPassword !== confirmPassword) {
		errors.confirmPassword = 'Mật khẩu xác nhận không khớp.';
	}

	return { errors, values: { currentPassword, newPassword, confirmPassword } };
}

router.get('/profile', (req, res, next) => {
	renderAccountPage(req, res, next, { section: 'profile' });
});

router.get('/security', (req, res, next) => {
	renderAccountPage(req, res, next, { section: 'security' });
});

router.get('/bidding', (req, res, next) => {
	renderAccountPage(req, res, next, { section: 'bidding' });
});

router.post('/profile', async (req, res, next) => {
	try {
		const { name = '', address = '' } = req.body || {};
		const userId = req.currentUser?.id;
		if (!userId) {
			return res.redirect('/auth/login');
		}

		const { errors, values } = validateProfileInput({ name, address });
		if (Object.keys(errors).length > 0) {
			const context = await buildAccountContext(req.currentUser, {
				profileForm: {
					name,
					address,
					email: req.currentUser?.email,
				},
				profileErrors: errors,
				activeSection: 'profile',
			});
			return res.status(400).render('account/overview', context);
		}

		const updatedUser = await userStore.updateUser(userId, {
			name: values.name,
			address: values.address,
		});

		const nextUser = updatedUser || { ...req.currentUser, ...values };
		req.currentUser = nextUser;
		res.locals.currentUser = nextUser;
		const context = await buildAccountContext(nextUser, {
			profileFlash: {
				type: 'success',
				message: 'Cập nhật thông tin cá nhân thành công.',
			},
			activeSection: 'profile',
		});
		res.render('account/overview', context);
	} catch (error) {
		next(error);
	}
});

router.post('/password', async (req, res, next) => {
	try {
		const { currentPassword = '', newPassword = '', confirmPassword = '' } = req.body || {};
		const user = req.currentUser;
		if (!user?.id) {
			return res.redirect('/auth/login');
		}

		const { errors, values } = validatePasswordInput({ currentPassword, newPassword, confirmPassword });
		if (Object.keys(errors).length > 0) {
			const context = await buildAccountContext(user, {
				passwordForm: values,
				passwordErrors: errors,
				activeSection: 'security',
			});
			return res.status(400).render('account/overview', context);
		}

		const hasPasswordHash = Boolean(user.passwordHash);
		if (hasPasswordHash) {
			const match = await bcrypt.compare(values.currentPassword, user.passwordHash);
			if (!match) {
				const context = await buildAccountContext(user, {
					passwordForm: values,
					passwordErrors: { currentPassword: 'Mật khẩu hiện tại không chính xác.' },
					activeSection: 'security',
				});
				return res.status(400).render('account/overview', context);
			}
		} else if (values.currentPassword !== '123456') {
			const context = await buildAccountContext(user, {
				passwordForm: values,
				passwordErrors: { currentPassword: 'Mật khẩu hiện tại không chính xác.' },
				activeSection: 'security',
			});
			return res.status(400).render('account/overview', context);
		}

		const passwordHash = await bcrypt.hash(values.newPassword, 10);
		const updatedUser = await userStore.updateUser(user.id, { passwordHash });

		const nextUser = updatedUser || { ...user, passwordHash };
		req.currentUser = nextUser;
		res.locals.currentUser = nextUser;
		const context = await buildAccountContext(nextUser, {
			passwordFlash: {
				type: 'success',
				message: 'Đổi mật khẩu thành công.',
			},
			activeSection: 'security',
		});
		res.render('account/overview', context);
	} catch (error) {
		next(error);
	}
});

module.exports = router;
