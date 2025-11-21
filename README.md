# PTUDW Online Auction Web App

This project is a server-side rendered online auction prototype inspired by Yahoo! Auctions and tailored to the functional requirements outlined in `docs/WorkFlow.md`. It is built with Express 5 and Handlebars, backed by mock data to showcase guest, bidder, seller, and administrator journeys.

## ✨ Key Features

- **Home experience** with hero banner and three dynamic top-five lists (ending soon, most bids, highest price).
- **Category navigation** featuring two-level menus and responsive toggles.
- **Product catalogue** with sorting, pagination, and category filters.
- **Product detail** pages including gallery, seller stats, bid history, Q&A, shipping/payment info, and related items.
- **Search** with keyword, category, and sort controls.
- **Secure authentication** with login, reCAPTCHA-protected registration, OTP verification, and bcrypt-hashed passwords.
- **Role-specific dashboards** for bidder overview, seller console (active/completed listings, auto-extend settings), and admin analytics.
- **Responsive UI** styled with a custom theme and enhanced with vanilla JavaScript (countdown timers, gallery interactions, mobile-friendly menus).

## 📦 Project Structure

```
project-web/
├── app.js                  # Express bootstrap & route wiring
├── package.json            # Dependencies and scripts
├── README.md
├── config/
│   └── index.js            # Centralised runtime configuration (reCAPTCHA & database)
├── db/
│   └── knex.js             # Knex singleton for Supabase Postgres
├── docs/
│   └── WorkFlow.md         # Original requirements
├── helpers/
│   └── handlebars.js       # View helpers (formatting, math, etc.)
├── public/
│   ├── css/style.css       # Global theme
│   └── js/main.js          # Front-end interactions
├── routes/
│   ├── account.js          # Bidder/Seller/Admin pages
│   ├── auth.js             # Login, register, OTP verification
│   ├── index.js            # Home & search
│   └── products.js         # Listings and detail
├── services/
│   ├── dataService.js      # Core data access layer (Supabase-backed)
│   ├── pendingRegistrations.js # In-memory OTP store during sign-up
│   ├── recaptcha.js        # Server-side reCAPTCHA v2 verification
│   └── userStore.js        # Supabase-backed user persistence
└── views/
   ├── layouts/main.handlebars
   ├── partials/           # Header, footer, category menu, product card, etc.
   ├── account/            # Role-specific templates
   ├── login/              # Login, register, OTP verification views
   ├── products/           # Listing + detail templates
   ├── search/results.handlebars
   └── 404.handlebars
```

## 🚀 Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Ensure Supabase is seeded**
   - Run the SQL in [🗄️ Database schema](#️-database-schema) on your Supabase Postgres instance.
   - Insert a row into `site_data` with `slug = 'primary'` and the JSON payload you want the site to render.

3. **Run the development server**
   ```bash
   npm start
   ```
   Then open <http://localhost:3000> in your browser.

   ### 🔐 Environment variables

   Create a `.env` file or export the following variables before starting the server:

   | Variable | Description |
   | --- | --- |
   | `DATABASE_HOST` | Supabase Postgres host (e.g. `aws-1-ap-southeast-1.pooler.supabase.com`). |
   | `DATABASE_PORT` | Database port, defaults to `5432`. |
   | `DATABASE_NAME` | Database name (default `postgres`). |
   | `DATABASE_USER` | Database user, e.g. `postgres.<hash>`. |
   | `DATABASE_PASSWORD` | Database password. |
   | `DATABASE_SSL` | Set to `true` to enable SSL (recommended for Supabase). |
   | `RECAPTCHA_SITE_KEY` | Google reCAPTCHA site key. |
   | `RECAPTCHA_SECRET` | Google reCAPTCHA secret. |

   > **Local development tips:**
   > - Without reCAPTCHA keys, use the placeholder token `test-pass` on the registration form.
   > - The application now requires a reachable Supabase Postgres instance with the tables and `site_data` payload described below.

   ### 🗄️ Database schema

   The app expects two tables in Supabase. They are created automatically when needed, but you can also run the SQL manually:

   ```sql
   create table if not exists site_data (
      slug text primary key,
      payload jsonb not null,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
   );

   create table if not exists users (
      id text primary key,
      role text not null default 'bidder',
      name text not null,
      address text,
      email text not null unique,
      password_hash text not null,
      created_at timestamptz default now(),
      updated_at timestamptz default now(),
      rating_plus integer default 0,
      rating_minus integer default 0,
      watchlist jsonb default '[]'::jsonb,
      active_bids jsonb default '[]'::jsonb,
      wins jsonb default '[]'::jsonb
   );
   ```

## 🧪 Smoke Checks

- Verified server boot with `node app.js` (port 3000).
- Confirmed Supabase `site_data` table returns the `primary` payload for homepage/catalogue content.
- Registration flow tested end-to-end with OTP confirmation (OTP emitted to server logs in development).

## 🛠️ Customisation Tips

- **View helpers**: Extend `helpers/handlebars.js` with additional formatting utilities when required.
- **Styling**: Adjust global theme tokens in `public/css/style.css` to adapt brand colours or typography.
- **Data layer**: Adjust the Supabase JSON payload stored in `site_data` or introduce dedicated tables and expand `services/dataService.js` accordingly.

## 📄 License

Released under the ISC license (see `package.json`).
