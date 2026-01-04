-- Migration: Nâng cấp Full-Text Search với unaccent và cải thiện ranking
-- Yêu cầu: PostgreSQL 12+

-- ============================================
-- 1. Cài đặt extension unaccent để bỏ dấu tiếng Việt
-- ============================================
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ============================================
-- 2. Tạo hàm immutable wrapper cho unaccent (cần thiết cho index)
-- ============================================
CREATE OR REPLACE FUNCTION auction.immutable_unaccent(text)
RETURNS text AS $$
  SELECT public.unaccent('public.unaccent', $1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

-- ============================================
-- 3. Tạo text search configuration hỗ trợ tiếng Việt
-- ============================================
DROP TEXT SEARCH CONFIGURATION IF EXISTS auction.vietnamese_unaccent CASCADE;
CREATE TEXT SEARCH CONFIGURATION auction.vietnamese_unaccent (COPY = simple);

-- Thêm dictionary unaccent vào configuration
ALTER TEXT SEARCH CONFIGURATION auction.vietnamese_unaccent
  ALTER MAPPING FOR word, asciiword, hword, hword_part, hword_asciipart
  WITH unaccent, simple;

-- ============================================
-- 4. Cập nhật trigger function để sử dụng unaccent
-- ============================================
CREATE OR REPLACE FUNCTION auction.products_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('auction.vietnamese_unaccent', auction.immutable_unaccent(coalesce(NEW.title, ''))), 'A') ||
    setweight(to_tsvector('auction.vietnamese_unaccent', auction.immutable_unaccent(coalesce(NEW.short_description, ''))), 'B') ||
    setweight(to_tsvector('auction.vietnamese_unaccent', auction.immutable_unaccent(coalesce(NEW.full_description, ''))), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. Cập nhật search_vector cho tất cả sản phẩm hiện có
-- ============================================
UPDATE auction.products SET
  search_vector = 
    setweight(to_tsvector('auction.vietnamese_unaccent', auction.immutable_unaccent(coalesce(title, ''))), 'A') ||
    setweight(to_tsvector('auction.vietnamese_unaccent', auction.immutable_unaccent(coalesce(short_description, ''))), 'B') ||
    setweight(to_tsvector('auction.vietnamese_unaccent', auction.immutable_unaccent(coalesce(full_description, ''))), 'C');

-- ============================================
-- 6. Đảm bảo GIN index đã tồn tại
-- ============================================
CREATE INDEX IF NOT EXISTS idx_products_search_vector ON auction.products USING GIN(search_vector);

-- ============================================
-- 7. Tạo index cho category_id để tối ưu filter
-- ============================================
CREATE INDEX IF NOT EXISTS idx_products_category_id ON auction.products(category_id);

-- ============================================
-- 8. Tạo hàm search tiện ích
-- ============================================
CREATE OR REPLACE FUNCTION auction.search_products(
  search_query TEXT,
  filter_category_id BIGINT DEFAULT NULL,
  sort_by TEXT DEFAULT 'relevance',
  page_number INT DEFAULT 1,
  page_size INT DEFAULT 12
)
RETURNS TABLE (
  product_id BIGINT,
  title TEXT,
  short_description TEXT,
  current_price NUMERIC,
  end_time TIMESTAMPTZ,
  category_id BIGINT,
  search_rank REAL,
  total_count BIGINT
) AS $$
DECLARE
  ts_query tsquery;
  offset_val INT;
BEGIN
  offset_val := (page_number - 1) * page_size;
  
  -- Tạo tsquery với unaccent
  IF search_query IS NOT NULL AND search_query != '' THEN
    ts_query := to_tsquery('auction.vietnamese_unaccent', 
      array_to_string(
        array(
          SELECT auction.immutable_unaccent(word) || ':*'
          FROM unnest(string_to_array(trim(search_query), ' ')) AS word
          WHERE word != ''
        ),
        ' & '
      )
    );
  END IF;
  
  RETURN QUERY
  WITH filtered_products AS (
    SELECT 
      p.id,
      p.title,
      p.short_description,
      p.current_price,
      p.end_time,
      p.category_id,
      CASE 
        WHEN ts_query IS NOT NULL THEN ts_rank_cd(p.search_vector, ts_query, 32)
        ELSE 0
      END AS rank,
      COUNT(*) OVER() AS total
    FROM auction.products p
    WHERE p.status = 'active'
      AND p.end_time > NOW()
      AND (
        ts_query IS NULL 
        OR p.search_vector @@ ts_query
        OR p.title ILIKE '%' || search_query || '%'
        OR p.short_description ILIKE '%' || search_query || '%'
      )
      AND (filter_category_id IS NULL OR p.category_id = filter_category_id)
  )
  SELECT 
    fp.id,
    fp.title,
    fp.short_description,
    fp.current_price,
    fp.end_time,
    fp.category_id,
    fp.rank,
    fp.total
  FROM filtered_products fp
  ORDER BY
    CASE WHEN sort_by = 'relevance' THEN fp.rank END DESC NULLS LAST,
    CASE WHEN sort_by = 'priceAsc' THEN fp.current_price END ASC,
    CASE WHEN sort_by = 'priceDesc' THEN fp.current_price END DESC,
    CASE WHEN sort_by = 'endingSoon' THEN fp.end_time END ASC,
    fp.end_time ASC
  LIMIT page_size OFFSET offset_val;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auction.search_products IS 'Full-text search với hỗ trợ unaccent tiếng Việt, phân trang và sắp xếp';

-- ============================================
-- Xong! Full-Text Search đã được nâng cấp
-- ============================================
