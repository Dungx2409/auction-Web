-- Schema: auction (Online Auction)
-- Tested for PostgreSQL 12+
SET client_min_messages = WARNING;

-- 1. Create schema
CREATE EXTENSION IF NOT EXISTS citext;
CREATE SCHEMA IF NOT EXISTS auction;
SET search_path = auction, public;

-- 2. Enumerations
CREATE TYPE auction.user_role AS ENUM ('guest', 'bidder', 'seller', 'admin');
CREATE TYPE auction.product_status AS ENUM ('draft','active','ended','removed');
CREATE TYPE auction.order_status AS ENUM (
  'await_payment', 'paid', 'shipped', 'completed', 'canceled'
);

-- 3. Users and related tables
CREATE TABLE auction.users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name TEXT NOT NULL,
  email CITEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  address TEXT,
  date_of_birth DATE,
  role auction.user_role NOT NULL DEFAULT 'bidder',
  rating_pos INTEGER NOT NULL DEFAULT 0 CHECK (rating_pos >= 0),
  rating_neg INTEGER NOT NULL DEFAULT 0 CHECK (rating_neg >= 0),
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE auction.users IS 'Người dùng: guest/bidder/seller/admin';
COMMENT ON COLUMN auction.users.email IS 'Unique login email (case-insensitive via citext)';
COMMENT ON COLUMN auction.users.password_hash IS 'Bcrypt/scrypt hash';
COMMENT ON COLUMN auction.users.rating_pos IS 'Số đánh giá +';
COMMENT ON COLUMN auction.users.rating_neg IS 'Số đánh giá -';

-- Track requests to upgrade account (bidder -> seller)
CREATE TABLE auction.user_upgrade_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES auction.users(id) ON DELETE SET NULL,
  request_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  status VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending/approved/rejected
  admin_note TEXT
);
COMMENT ON TABLE auction.user_upgrade_requests IS 'Yêu cầu nâng cấp tài khoản';

-- 4. Categories (2-level)
CREATE TABLE auction.categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id BIGINT REFERENCES auction.categories(id) ON DELETE RESTRICT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE auction.categories IS 'Danh mục (hỗ trợ 2 cấp qua parent_id)';

-- Prevent deleting category if products exist (enforced via FK in products with ON DELETE RESTRICT)

-- 5. Products and images, appended descriptions
CREATE TABLE auction.products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id BIGINT NOT NULL REFERENCES auction.users(id) ON DELETE SET NULL,
  category_id BIGINT REFERENCES auction.categories(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  short_description TEXT,
  -- full rich description stored as HTML in JSONB or text
  full_description TEXT,
  start_price NUMERIC(20,2) NOT NULL CHECK (start_price >= 0),
  current_price NUMERIC(20,2) NOT NULL CHECK (current_price >= 0),
  step_price NUMERIC(20,2) NOT NULL CHECK (step_price >= 0),
  buy_now_price NUMERIC(20,2),
  auto_extend BOOLEAN NOT NULL DEFAULT FALSE,
  start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_time TIMESTAMPTZ NOT NULL,
  status auction.product_status NOT NULL DEFAULT 'draft',
  bid_count INTEGER NOT NULL DEFAULT 0 CHECK (bid_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE auction.products IS 'Sản phẩm đấu giá';
COMMENT ON COLUMN auction.products.current_price IS 'Giá hiện tại (cập nhật bởi ứng dụng khi có bid)';
COMMENT ON COLUMN auction.products.auto_extend IS 'Nếu true, khi có bid trong threshold thì gia hạn theo system settings';

-- Product images
CREATE TABLE auction.product_images (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT REFERENCES auction.products(id) ON DELETE RESTRICT,
  image_url TEXT NOT NULL,
  alt_text TEXT,
  is_thumbnail BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE auction.product_images IS 'Ảnh sản phẩm; ít nhất 3 ảnh trên UI (kiểm tra trên app)';

-- Appended descriptions (seller can append content; do not replace)
CREATE TABLE auction.product_append_descriptions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT REFERENCES auction.products(id) ON DELETE RESTRICT,
  content TEXT NOT NULL,
  created_by BIGINT REFERENCES auction.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE auction.product_append_descriptions IS 'Các mục bổ sung vào mô tả (append-only)';

-- 6. Bids (including auto-bid intentions)
CREATE TABLE auction.bids (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES auction.products(id) ON DELETE RESTRICT,
  bidder_id BIGINT NOT NULL REFERENCES auction.users(id) ON DELETE SET NULL,
  bid_price NUMERIC(20,2) NOT NULL CHECK (bid_price >= 0),
  is_auto BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE auction.bids IS 'Các lượt ra giá (các lượt ghi lịch sử). is_auto true nếu là hệ tự động.';

-- Auto-bid (max price that user willing to pay)
CREATE TABLE auction.auto_bids (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES auction.products(id) ON DELETE RESTRICT,
  bidder_id BIGINT NOT NULL REFERENCES auction.users(id) ON DELETE SET NULL,
  max_price NUMERIC(20,2) NOT NULL CHECK (max_price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, bidder_id)
);
COMMENT ON TABLE auction.auto_bids IS 'Thiết lập đấu giá tự động (max giá)';

-- Bid rejections: seller can reject a bidder (for that product)
CREATE TABLE auction.bid_rejections (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES auction.products(id) ON DELETE RESTRICT,
  bidder_id BIGINT NOT NULL REFERENCES auction.users(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE auction.bid_rejections IS 'Người bán có thể từ chối 1 bidder cho sản phẩm';

-- 7. Watchlist & Q&A
CREATE TABLE auction.watchlists (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES auction.users(id) ON DELETE SET NULL,
  product_id BIGINT NOT NULL REFERENCES auction.products(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, product_id)
);
COMMENT ON TABLE auction.watchlists IS 'Danh sách yêu thích (watch list)';

CREATE TABLE auction.questions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES auction.products(id) ON DELETE RESTRICT,
  buyer_id BIGINT REFERENCES auction.users(id) ON DELETE SET NULL,
  question_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE auction.questions IS 'Câu hỏi của người mua tới người bán';

CREATE TABLE auction.answers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question_id BIGINT NOT NULL REFERENCES auction.questions(id) ON DELETE CASCADE,
  seller_id BIGINT REFERENCES auction.users(id) ON DELETE SET NULL,
  answer_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE auction.answers IS 'Trả lời của người bán cho câu hỏi (note: deleting question deletes answers)';

-- 8. Ratings between users
CREATE TABLE auction.ratings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_user_id BIGINT NOT NULL REFERENCES auction.users(id) ON DELETE SET NULL,
  to_user_id BIGINT NOT NULL REFERENCES auction.users(id) ON DELETE SET NULL,
  product_id BIGINT REFERENCES auction.products(id) ON DELETE SET NULL,
  score SMALLINT NOT NULL CHECK (score IN (-1, 1)),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_user_id, to_user_id, product_id) -- one rating per transaction
);
COMMENT ON TABLE auction.ratings IS 'Đánh giá sau giao dịch: +1 hoặc -1';

-- 9. Orders / Fulfillment / Chat for completing transaction
CREATE TABLE auction.orders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES auction.products(id) ON DELETE SET NULL,
  seller_id BIGINT REFERENCES auction.users(id) ON DELETE SET NULL,
  buyer_id BIGINT REFERENCES auction.users(id) ON DELETE SET NULL,
  status auction.order_status NOT NULL DEFAULT 'await_payment',
  total_price NUMERIC(20,2) NOT NULL CHECK (total_price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE auction.orders IS 'Quy trình hoàn tất đơn hàng sau khi phiên đấu giá kết thúc';

CREATE TABLE auction.order_invoices (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES auction.orders(id) ON DELETE CASCADE,
  billing_address TEXT,
  shipping_address TEXT,
  payment_proof TEXT, -- could be URL to uploaded receipt
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE auction.order_invoices IS 'Khoá lưu bằng chứng thanh toán, địa chỉ giao hàng';

CREATE TABLE auction.order_shipments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES auction.orders(id) ON DELETE CASCADE,
  tracking_number TEXT,
  shipping_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE auction.order_shipments IS 'Thông tin vận chuyển';

CREATE TABLE auction.order_chats (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES auction.orders(id) ON DELETE CASCADE,
  sender_id BIGINT REFERENCES auction.users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE auction.order_chats IS 'Chat giữa người bán và người mua trong quá trình hoàn tất đơn hàng';

-- 10. System tables: email logs and settings
CREATE TABLE auction.email_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  to_user_id BIGINT REFERENCES auction.users(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  body TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE auction.email_logs IS 'Lịch sử email thông báo';

CREATE TABLE auction.system_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE auction.system_settings IS 'Các tham số hệ thống như auto_extend_threshold_minutes, auto_extend_amount_minutes';

-- 11. Full text search support for products
-- Add a tsvector column and trigger to update it
ALTER TABLE auction.products ADD COLUMN search_vector tsvector;

CREATE INDEX idx_products_search_vector ON auction.products USING GIN(search_vector);

-- Initialize trigger function to update tsvector from title and description
CREATE OR REPLACE FUNCTION auction.products_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    to_tsvector('simple', coalesce(NEW.title,'') || ' ' || coalesce(NEW.short_description,'') || ' ' || coalesce(NEW.full_description,''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_products_search_vector
BEFORE INSERT OR UPDATE ON auction.products
FOR EACH ROW EXECUTE PROCEDURE auction.products_search_vector_update();

-- 12. Indexes that are useful
CREATE INDEX idx_products_end_time ON auction.products (end_time);
CREATE INDEX idx_products_status_endtime ON auction.products (status, end_time);
CREATE INDEX idx_bids_product_created_at ON auction.bids (product_id, created_at DESC);
CREATE INDEX idx_auto_bids_product ON auction.auto_bids (product_id, bidder_id);
CREATE INDEX idx_users_email ON auction.users (email);

-- 13. Useful check constraints and helper views
-- Example view: top active products by bid_count
CREATE OR REPLACE VIEW auction.v_top_by_bidcount AS
SELECT id, title, seller_id, category_id, current_price, bid_count, end_time
FROM auction.products
WHERE status = 'active'
ORDER BY bid_count DESC, end_time ASC;

COMMENT ON VIEW auction.v_top_by_bidcount IS 'Top products by number of bids (active only)';

-- 14. Triggers / audits (minimal example: update updated_at)
CREATE OR REPLACE FUNCTION auction.set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach to tables that have updated_at
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON auction.users
FOR EACH ROW EXECUTE PROCEDURE auction.set_updated_at();
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON auction.products
FOR EACH ROW EXECUTE PROCEDURE auction.set_updated_at();
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON auction.orders
FOR EACH ROW EXECUTE PROCEDURE auction.set_updated_at();

-- 15. Policies / Notes printed for developer
COMMENT ON SCHEMA auction IS 'Schema for Online Auction app (WorkFlow.pdf)';

-- 16. Seed data for local development
-- Run the statements below to populate a minimal dataset that matches the
-- expectations of the Express application (home page highlights, authentication, etc.).

-- System configuration
INSERT INTO auction.system_settings (key, value)
VALUES
  ('auto_extend_threshold_minutes', '5'),
  ('auto_extend_amount_minutes', '5')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

-- Core users (password for all sample accounts is `123456`)
INSERT INTO auction.users (id, full_name, email, password_hash, address, role, rating_pos, rating_neg)
OVERRIDING SYSTEM VALUE
VALUES
  (1001, 'Nguyễn Bán Hàng', 'seller@example.com', '$2a$10$01oY2YZB.TKXrsviT.HdseGsWSlIgHtuuqbtj1c71E8A4aAzDGfrC', 'Hà Nội, Việt Nam', 'seller', 72, 3),
  (1002, 'Trần Đấu Giá', 'bidder@example.com', '$2a$10$01oY2YZB.TKXrsviT.HdseGsWSlIgHtuuqbtj1c71E8A4aAzDGfrC', 'Đà Nẵng, Việt Nam', 'bidder', 24, 1),
  (1003, 'Lê Quản Trị', 'admin@example.com', '$2a$10$01oY2YZB.TKXrsviT.HdseGsWSlIgHtuuqbtj1c71E8A4aAzDGfrC', 'TP. Hồ Chí Minh, Việt Nam', 'admin', 54, 2)
ON CONFLICT (email) DO UPDATE
SET full_name = EXCLUDED.full_name,
    password_hash = EXCLUDED.password_hash,
    address = EXCLUDED.address,
    role = EXCLUDED.role,
    rating_pos = EXCLUDED.rating_pos,
    rating_neg = EXCLUDED.rating_neg,
    updated_at = now();

-- Category hierarchy (two levels)
INSERT INTO auction.categories (id, name, parent_id, description)
OVERRIDING SYSTEM VALUE
VALUES
  (100, 'Điện tử', NULL, 'Thiết bị điện tử chính hãng'),
  (101, 'Điện thoại di động', 100, 'Smartphone mới nhất'),
  (102, 'Máy tính xách tay', 100, 'Laptop văn phòng và đồ họa'),
  (200, 'Thời trang', NULL, 'Thời trang cao cấp và phụ kiện'),
  (201, 'Giày sneaker', 200, 'Sneaker giới hạn'),
  (202, 'Đồng hồ', 200, 'Đồng hồ chính hãng')
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    parent_id = EXCLUDED.parent_id,
    description = EXCLUDED.description;

-- Sample products that power the homepage sections
INSERT INTO auction.products (
  id,
  seller_id,
  category_id,
  title,
  short_description,
  full_description,
  start_price,
  current_price,
  step_price,
  buy_now_price,
  auto_extend,
  start_time,
  end_time,
  status,
  bid_count
)
OVERRIDING SYSTEM VALUE
VALUES
  (
    5001,
    1001,
    101,
    'iPhone 15 Pro Max 256GB - Titan',
    'Máy đẹp 99%, pin trên 95%.',
    '<p>Bản VN/A, tặng kèm ốp lưng và kính cường lực.</p><ul><li>Bảo hành hãng 10/2026</li><li>Hỗ trợ trả góp 0%</li></ul>',
    20000000,
    21500000,
    200000,
    26990000,
    TRUE,
    now() - interval '2 day',
    now() + interval '1 day',
    'active',
    5
  ),
  (
    5002,
    1001,
    102,
    'MacBook Air M3 16GB/512GB',
    'Hàng chính hãng, likenew.',
    '<p>Máy mua 09/2025, kèm hóa đơn điện tử.</p><p>Tặng túi chống sốc.</p>',
    23000000,
    24800000,
    300000,
    31990000,
    TRUE,
    now() - interval '3 day',
    now() + interval '2 day',
    'active',
    7
  ),
  (
    5003,
    1001,
    201,
    'Nike Air Jordan 1 Retro High',
    'Size 42, fullbox chưa on feet.',
    '<p>Phiên bản OG 2024, tem chuẩn SNKRS.</p><p>Ship toàn quốc.</p>',
    4500000,
    5200000,
    120000,
    6800000,
    FALSE,
    now() - interval '1 day',
    now() + interval '12 hour',
    'active',
    4
  )
ON CONFLICT (id) DO UPDATE
SET seller_id = EXCLUDED.seller_id,
    category_id = EXCLUDED.category_id,
    title = EXCLUDED.title,
    short_description = EXCLUDED.short_description,
    full_description = EXCLUDED.full_description,
    start_price = EXCLUDED.start_price,
    current_price = EXCLUDED.current_price,
    step_price = EXCLUDED.step_price,
    buy_now_price = EXCLUDED.buy_now_price,
    auto_extend = EXCLUDED.auto_extend,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    status = EXCLUDED.status,
    bid_count = EXCLUDED.bid_count,
    updated_at = now();

-- Product imagery
INSERT INTO auction.product_images (id, product_id, image_url, alt_text, is_thumbnail, position)
OVERRIDING SYSTEM VALUE
VALUES
  (7001, 5001, 'https://images.unsplash.com/photo-1695048139036-d56831281e8c?auto=format&fit=crop&w=900&q=80', 'iPhone 15 Pro Max mặt trước', TRUE, 0),
  (7002, 5001, 'https://images.unsplash.com/photo-1695048138780-5d13696358bf?auto=format&fit=crop&w=900&q=80', 'iPhone 15 Pro Max mặt lưng', FALSE, 1),
  (7003, 5001, 'https://images.unsplash.com/photo-1695048138258-0a1bb529d590?auto=format&fit=crop&w=900&q=80', 'Phụ kiện iPhone 15 Pro Max', FALSE, 2),
  (7011, 5002, 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=900&q=80', 'MacBook Air M3 tổng thể', TRUE, 0),
  (7012, 5002, 'https://images.unsplash.com/photo-1517436073-3b1f5be6a41e?auto=format&fit=crop&w=900&q=80', 'MacBook Air M3 bàn phím', FALSE, 1),
  (7013, 5002, 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80', 'MacBook Air M3 nghiêng', FALSE, 2),
  (7021, 5003, 'https://images.unsplash.com/photo-1523381432-29fa891d0c54?auto=format&fit=crop&w=900&q=80', 'Nike Air Jordan 1 tổng thể', TRUE, 0),
  (7022, 5003, 'https://images.unsplash.com/photo-1475180098004-ca77a66827be?auto=format&fit=crop&w=900&q=80', 'Nike Air Jordan 1 chi tiết', FALSE, 1),
  (7023, 5003, 'https://images.unsplash.com/photo-1460353581641-37baddab0fa2?auto=format&fit=crop&w=900&q=80', 'Hộp sneaker Jordan 1', FALSE, 2)
ON CONFLICT (id) DO UPDATE
SET product_id = EXCLUDED.product_id,
    image_url = EXCLUDED.image_url,
    alt_text = EXCLUDED.alt_text,
    is_thumbnail = EXCLUDED.is_thumbnail,
    position = EXCLUDED.position;

-- Bid history to surface highest bidder data on detail pages
INSERT INTO auction.bids (id, product_id, bidder_id, bid_price, is_auto, created_at)
OVERRIDING SYSTEM VALUE
VALUES
  (9001, 5001, 1002, 21000000, FALSE, now() - interval '18 hour'),
  (9002, 5001, 1002, 21250000, FALSE, now() - interval '6 hour'),
  (9003, 5001, 1002, 21500000, FALSE, now() - interval '3 hour'),
  (9011, 5002, 1002, 24000000, FALSE, now() - interval '8 hour'),
  (9021, 5003, 1002, 5000000, FALSE, now() - interval '4 hour')
ON CONFLICT (id) DO UPDATE
SET product_id = EXCLUDED.product_id,
    bidder_id = EXCLUDED.bidder_id,
    bid_price = EXCLUDED.bid_price,
    is_auto = EXCLUDED.is_auto,
    created_at = EXCLUDED.created_at;

-- Watchlist sample so bidder dashboard has content
INSERT INTO auction.watchlists (id, user_id, product_id, created_at)
OVERRIDING SYSTEM VALUE
VALUES
  (9501, 1002, 5001, now() - interval '1 day'),
  (9502, 1002, 5002, now() - interval '16 hour')
ON CONFLICT (user_id, product_id) DO UPDATE
SET created_at = EXCLUDED.created_at;

-- Simple Q&A for product detail page
INSERT INTO auction.questions (id, product_id, buyer_id, question_text, created_at)
OVERRIDING SYSTEM VALUE
VALUES
  (9601, 5001, 1002, 'Máy còn hộp và phụ kiện đầy đủ chứ?', now() - interval '10 hour')
ON CONFLICT (id) DO UPDATE
SET product_id = EXCLUDED.product_id,
    buyer_id = EXCLUDED.buyer_id,
    question_text = EXCLUDED.question_text,
    created_at = EXCLUDED.created_at;

INSERT INTO auction.answers (id, question_id, seller_id, answer_text, created_at)
OVERRIDING SYSTEM VALUE
VALUES
  (9701, 9601, 1001, 'Fullbox như mới, tặng thêm ốp UAG.', now() - interval '8 hour')
ON CONFLICT (id) DO UPDATE
SET question_id = EXCLUDED.question_id,
    seller_id = EXCLUDED.seller_id,
    answer_text = EXCLUDED.answer_text,
    created_at = EXCLUDED.created_at;

-- Ensure identity sequences move past seeded values
SELECT setval(pg_get_serial_sequence('auction.users', 'id'), (SELECT MAX(id) FROM auction.users));
SELECT setval(pg_get_serial_sequence('auction.categories', 'id'), (SELECT MAX(id) FROM auction.categories));
SELECT setval(pg_get_serial_sequence('auction.products', 'id'), (SELECT MAX(id) FROM auction.products));
SELECT setval(pg_get_serial_sequence('auction.product_images', 'id'), (SELECT MAX(id) FROM auction.product_images));
SELECT setval(pg_get_serial_sequence('auction.bids', 'id'), (SELECT MAX(id) FROM auction.bids));
SELECT setval(pg_get_serial_sequence('auction.watchlists', 'id'), (SELECT MAX(id) FROM auction.watchlists));
SELECT setval(pg_get_serial_sequence('auction.questions', 'id'), (SELECT MAX(id) FROM auction.questions));
SELECT setval(pg_get_serial_sequence('auction.answers', 'id'), (SELECT MAX(id) FROM auction.answers));
