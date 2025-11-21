const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { engine } = require('express-handlebars');

const dataService = require('./services/dataService');
const hbsHelpers = require('./helpers/handlebars');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;

// Express middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// View engine configuration
app.engine(
	'handlebars',
	engine({
		defaultLayout: 'main',
		layoutsDir: path.join(__dirname, 'views', 'layouts'),
		partialsDir: path.join(__dirname, 'views', 'partials'),
		helpers: hbsHelpers,
	})
);
app.set('view engine', 'handlebars');
app.set('views', path.join(__dirname, 'views'));

// Share common data with every view
app.use(async (req, res, next) => {
	try {
		const [categories, settings] = await Promise.all([
			dataService.getCategories(),
			dataService.getSettings(),
		]);

		let currentUser = null;
		const rawUserId = req.cookies?.userId;
		if (rawUserId) {
			const numericId = Number(rawUserId);
			const lookupId = Number.isNaN(numericId) ? rawUserId : numericId;
			currentUser = (await dataService.getUserById(lookupId)) || null;
			if (!currentUser) {
				res.clearCookie('userId');
			}
		}

		req.currentUser = currentUser;
		res.locals.currentUser = currentUser;
		res.locals.site = {
			categories,
			settings,
		};
		res.locals.config = config;
		res.locals.showCategorySidebar =
			req.path === '/' || req.path.startsWith('/products');
		next();
	} catch (error) {
		next(error);
	}
});

// Routes
const indexRouter = require('./routes/index');
const productsRouter = require('./routes/products');
const accountRouter = require('./routes/account');
const authRouter = require('./routes/auth');

app.use('/', indexRouter);
app.use('/products', productsRouter);
app.use('/account', accountRouter);
app.use('/auth', authRouter);

// Fallback 404
app.use((req, res) => {
	res.status(404).render('404', { title: 'Không tìm thấy trang' });
});

app.listen(PORT, () => {
	console.log(`Server started: http://localhost:${PORT}`);
});

module.exports = app;
