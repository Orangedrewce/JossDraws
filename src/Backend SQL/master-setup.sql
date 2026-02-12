-- ============================================================================
-- MASTER SQL — JossDraws Complete Backend Setup
-- ============================================================================
-- Generated: 2025-02-11  |  Updated: 2026-02-11
-- This script is IDEMPOTENT — safe to re-run at any time.
-- If anything breaks, paste this entire script into Supabase SQL Editor.
--
-- PREREQUISITE: The 'tokens', 'reviews', and 'gallery_items' tables must
--               already exist (created via Supabase dashboard or prior migration).
--
-- EXECUTION ORDER (dependencies flow top → bottom):
--   PHASE 1 — Nuclear cleanup: drop ALL function overloads
--   PHASE 2 — Extensions: pgcrypto, pg_net
--   PHASE 3 — Tables & columns: admin_config, admin_attempts, hero_slides,
--             shop_items, shop_page_titles, reviews.deleted_at,
--             about_photo_url, about_bio_text
--   PHASE 4 — RLS policies: tokens, admin_config, admin_attempts,
--             hero_slides, shop_items, reviews
--   PHASE 5 — CHECK constraints: reviews table
--   PHASE 6 — Core auth functions: lockout helpers, verify_admin,
--             admin_create/delete_token, admin_change_code
--   PHASE 7 — Review submission: submit_review + Discord webhook trigger
--   PHASE 7b — Review moderation: list, approve, deny, delete, restore, purge
--   PHASE 7c — Public API: get_approved_reviews (server-filtered)
--   PHASE 8 — Gallery function: admin_move_gallery_item
--   PHASE 9 — Hero slide functions: full CRUD + reorder
--   PHASE 10 — Shop item functions: full CRUD + reorder
--   PHASE 11 — Shop page title functions: admin get/set
--   PHASE 12 — Public API: get_active_shop_items (final version w/ page_titles)
--   PHASE 12b — About content: admin get/set + public get
--   PHASE 13 — Seed data: 6 shop products (only if table is empty)
--   PHASE 14 — Grants: anon/authenticated access to public RPCs
--   PHASE 15 — Verify: schema reload + validation queries
-- ============================================================================


-- ============================================================================
-- PHASE 1: NUCLEAR CLEANUP — Drop ALL function overloads
-- ============================================================================
-- Dynamically finds and drops EVERY overload of every managed function,
-- regardless of parameter types. No stale versions survive this.
-- ============================================================================

DO $$
DECLARE
  fn RECORD;
  fn_names TEXT[] := ARRAY[
    -- Review system
    'submit_review',
    'notify_discord_new_review',
    '_check_admin_lockout',
    '_record_admin_failure',
    'verify_admin',
    'admin_create_token',
    'admin_delete_token',
    'admin_change_code',
    -- Gallery
    'admin_move_gallery_item',
    -- Hero slides
    'admin_list_hero_slides',
    'admin_add_hero_slide',
    'admin_toggle_hero_slide',
    'admin_delete_hero_slide',
    'admin_edit_hero_slide',
    'admin_move_hero_slide',
    'admin_reorder_hero_slide',
    -- Shop items
    'admin_list_shop_items',
    'admin_add_shop_item',
    'admin_edit_shop_item',
    'admin_toggle_shop_item',
    'admin_delete_shop_item',
    'admin_move_shop_item',
    'admin_reorder_shop_item',
    -- Shop page titles
    'admin_get_shop_page_titles',
    'admin_set_shop_page_titles',
    -- Review moderation
    'admin_list_reviews',
    'admin_approve_review',
    'admin_deny_review',
    'admin_delete_review',
    'admin_restore_review',
    'admin_purge_review',
    'admin_move_review',
    -- About content
    'admin_get_about_content',
    'admin_set_about_content',
    'get_about_content',
    -- Public API
    'get_active_shop_items',
    'get_approved_reviews'
  ];
  fn_name TEXT;
BEGIN
  FOREACH fn_name IN ARRAY fn_names LOOP
    FOR fn IN
      SELECT oid::regprocedure AS signature
      FROM pg_proc
      WHERE proname = fn_name
        AND pronamespace = 'public'::regnamespace
    LOOP
      EXECUTE 'DROP FUNCTION IF EXISTS ' || fn.signature || ' CASCADE';
      RAISE NOTICE 'Dropped: %', fn.signature;
    END LOOP;
  END LOOP;
END $$;


-- ============================================================================
-- PHASE 2: EXTENSIONS
-- ============================================================================

-- pgcrypto for bcrypt hashing (admin code verification)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- pg_net for async HTTP (Discord webhook)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;


-- ============================================================================
-- PHASE 3: TABLES & COLUMNS
-- ============================================================================

-- 3a. admin_config — single-row config table (bcrypt-hashed admin code + settings)
CREATE TABLE IF NOT EXISTS admin_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  code_hash TEXT NOT NULL
);

-- Seed the admin code hash (idempotent — skips if row already exists)
INSERT INTO admin_config (id, code_hash)
VALUES (1, extensions.crypt('102762', extensions.gen_salt('bf')))
ON CONFLICT (id) DO NOTHING;

-- 3b. admin_attempts — brute-force tracking
CREATE TABLE IF NOT EXISTS admin_attempts (
  id BIGSERIAL PRIMARY KEY,
  ip_hint TEXT,          -- optional, just for logging
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3c. hero_slides — landing-page banner images
CREATE TABLE IF NOT EXISTS hero_slides (
  id          BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  img_url     TEXT NOT NULL,
  sort_order  INT  NOT NULL DEFAULT 0,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hero_slides_active_sort
  ON hero_slides (is_active, sort_order);

-- 3d. shop_items — products displayed on the shop page
CREATE TABLE IF NOT EXISTS shop_items (
  id            BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  title         TEXT NOT NULL,
  price_display TEXT NOT NULL,
  etsy_url      TEXT NOT NULL,
  section_label TEXT DEFAULT '',
  media         JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active     BOOLEAN DEFAULT true,
  sort_order    INT  NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shop_items_active_sort
  ON shop_items (is_active, sort_order);

-- 3e. shop_page_titles — JSONB column on admin_config
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_config' AND column_name = 'shop_page_titles'
  ) THEN
    ALTER TABLE admin_config
      ADD COLUMN shop_page_titles JSONB DEFAULT '["Best Sellers", "More Products"]'::jsonb;
    RAISE NOTICE 'Added shop_page_titles column to admin_config';
  ELSE
    RAISE NOTICE 'shop_page_titles column already exists — skipping';
  END IF;
END $$;

-- Ensure the row has a default value if column was added after row creation
UPDATE admin_config
   SET shop_page_titles = '["Best Sellers", "More Products"]'::jsonb
 WHERE id = 1 AND shop_page_titles IS NULL;

-- 3f. deleted_at on reviews (soft delete for review moderation)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reviews' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE reviews ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;
    RAISE NOTICE 'Added deleted_at column to reviews';
  ELSE
    RAISE NOTICE 'deleted_at column already exists — skipping';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reviews_deleted_at ON reviews (deleted_at);

-- 3g. review_sort_order on reviews (for drag-and-drop reordering of approved reviews)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reviews' AND column_name = 'review_sort_order'
  ) THEN
    ALTER TABLE reviews ADD COLUMN review_sort_order INT DEFAULT 0;
    RAISE NOTICE 'Added review_sort_order column to reviews';
  ELSE
    RAISE NOTICE 'review_sort_order column already exists — skipping';
  END IF;
END $$;

-- Backfill: assign sort_order to existing approved reviews based on created_at
DO $$
DECLARE
  rec RECORD;
  i INT := 1;
BEGIN
  FOR rec IN
    SELECT id FROM reviews
     WHERE is_approved = true AND deleted_at IS NULL AND (review_sort_order = 0 OR review_sort_order IS NULL)
     ORDER BY created_at DESC
  LOOP
    UPDATE reviews SET review_sort_order = i WHERE id = rec.id;
    i := i + 1;
  END LOOP;
END $$;

-- 3h. about_photo_url on admin_config
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_config' AND column_name = 'about_photo_url'
  ) THEN
    ALTER TABLE admin_config ADD COLUMN about_photo_url TEXT DEFAULT 'https://lh3.googleusercontent.com/d/1t-dOjZJLTpkC2UdUmhvdRNWlfm8wM1pG';
    RAISE NOTICE 'Added about_photo_url column to admin_config';
  ELSE
    RAISE NOTICE 'about_photo_url column already exists — skipping';
  END IF;
END $$;

-- 3h. about_bio_text on admin_config
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_config' AND column_name = 'about_bio_text'
  ) THEN
    ALTER TABLE admin_config ADD COLUMN about_bio_text TEXT DEFAULT 'My name is <strong>Joslynn Losee</strong> I am a 25 year old multidisciplinary artist who specializes in illustration and graphic design.<br><br><h3>A <em>bit</em> about me</h3><p>I''m a local Salt Lake City artist whose creative career began in 2019 with the launch of my Etsy shop. After graduating from MTECH in 2021 with a degree in graphic design, one of my earliest listings unexpectedly went viral, propelling me into the world of professional art.<br><br>Through experimentation, learning from mistakes, and persistent dedication, I''ve honed my techniques and refined my artistic process. I''m deeply grateful to the friends and family who have supported me along the way.<br><br>I look forward to continuing to create art that brings joy to everyone who encounters it.</p>';
    RAISE NOTICE 'Added about_bio_text column to admin_config';
  ELSE
    RAISE NOTICE 'about_bio_text column already exists — skipping';
  END IF;
END $$;

-- Seed about defaults for existing row
UPDATE admin_config
   SET about_photo_url = COALESCE(about_photo_url, 'https://lh3.googleusercontent.com/d/1t-dOjZJLTpkC2UdUmhvdRNWlfm8wM1pG'),
       about_bio_text  = COALESCE(about_bio_text, 'My name is Joslynn Losee...')
 WHERE id = 1;


-- ============================================================================
-- PHASE 4: ROW-LEVEL SECURITY
-- ============================================================================

-- 4a. admin_config — no public policies = no access for anon/authenticated
ALTER TABLE admin_config ENABLE ROW LEVEL SECURITY;

-- 4b. admin_attempts — no public access
ALTER TABLE admin_attempts ENABLE ROW LEVEL SECURITY;

-- 4c. tokens — public SELECT only; writes via SECURITY DEFINER functions
ALTER TABLE tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tokens_all_access" ON tokens;
DROP POLICY IF EXISTS "tokens_select_public" ON tokens;
DROP POLICY IF EXISTS "tokens_insert_admin" ON tokens;
DROP POLICY IF EXISTS "tokens_update_service" ON tokens;
DROP POLICY IF EXISTS "tokens_delete_admin" ON tokens;

CREATE POLICY "tokens_select_public" ON tokens
  FOR SELECT TO anon, authenticated
  USING (true);

-- 4d. hero_slides — public SELECT active, service role full access
ALTER TABLE hero_slides ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hero_slides' AND policyname = 'Public can view active hero slides'
  ) THEN
    CREATE POLICY "Public can view active hero slides"
      ON hero_slides FOR SELECT
      USING (is_active = true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hero_slides' AND policyname = 'Service role full access hero slides'
  ) THEN
    CREATE POLICY "Service role full access hero slides"
      ON hero_slides FOR ALL
      USING ( auth.role() = 'service_role' );
  END IF;
END $$;

-- 4e. shop_items — public SELECT active, service role full access
ALTER TABLE shop_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'shop_items' AND policyname = 'Public can view active shop items'
  ) THEN
    CREATE POLICY "Public can view active shop items"
      ON shop_items FOR SELECT
      USING (is_active = true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'shop_items' AND policyname = 'Service role full access shop items'
  ) THEN
    CREATE POLICY "Service role full access shop items"
      ON shop_items FOR ALL
      USING ( auth.role() = 'service_role' );
  END IF;
END $$;

-- 4f. reviews — anon can only read approved non-deleted; can insert new
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reviews_anon_read ON reviews;
DROP POLICY IF EXISTS reviews_anon_insert ON reviews;

CREATE POLICY reviews_anon_read ON reviews
  FOR SELECT
  TO anon
  USING (is_approved = true AND deleted_at IS NULL);

CREATE POLICY reviews_anon_insert ON reviews
  FOR INSERT
  TO anon
  WITH CHECK (true);


-- ============================================================================
-- PHASE 5: CHECK CONSTRAINTS (reviews table)
-- ============================================================================

-- Name format (letters, spaces, hyphens, periods only; 1–60 chars)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviews_name_format'
  ) THEN
    ALTER TABLE reviews
    ADD CONSTRAINT reviews_name_format
    CHECK (
      client_name ~ '^[a-zA-Z\s\.\-]+$'
      AND length(client_name) BETWEEN 1 AND 60
    );
  END IF;
END $$;

-- Review text length (1–280 chars)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviews_text_length'
  ) THEN
    ALTER TABLE reviews
    ADD CONSTRAINT reviews_text_length
    CHECK (
      length(review_text) BETWEEN 1 AND 280
    );
  END IF;
END $$;

-- Source allowlist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviews_source_check'
  ) THEN
    ALTER TABLE reviews
    ADD CONSTRAINT reviews_source_check
    CHECK (
      source IN (
        'commission', 'etsy', 'print', 'sticker',
        'bookmark', 'pet_portrait', 'faceless_portrait',
        'coloring_book', 'general'
      )
    );
  END IF;
END $$;


-- ============================================================================
-- PHASE 6: CORE AUTH FUNCTIONS
-- ============================================================================

-- 6a. _check_admin_lockout — returns true if locked out
--     Threshold: 10 failed attempts in last 15 minutes
CREATE OR REPLACE FUNCTION _check_admin_lockout()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_failures INT;
BEGIN
  SELECT count(*) INTO v_recent_failures
  FROM admin_attempts
  WHERE attempted_at > NOW() - INTERVAL '15 minutes';

  RETURN v_recent_failures >= 10;
END;
$$;

-- 6b. _record_admin_failure — logs a failed attempt + housekeeping
CREATE OR REPLACE FUNCTION _record_admin_failure()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO admin_attempts (attempted_at) VALUES (NOW());
  -- Housekeeping: purge attempts older than 1 hour
  DELETE FROM admin_attempts WHERE attempted_at < NOW() - INTERVAL '1 hour';
END;
$$;

-- 6c. verify_admin — lightweight code check (used on page load)
CREATE OR REPLACE FUNCTION verify_admin(p_admin_code TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  IF _check_admin_lockout() THEN
    RETURN json_build_object('success', false, 'error', 'Too many attempts. Try again in 15 minutes.');
  END IF;

  SELECT code_hash INTO v_hash FROM admin_config WHERE id = 1;
  IF v_hash IS NULL OR extensions.crypt(p_admin_code, v_hash) != v_hash THEN
    PERFORM _record_admin_failure();
    RETURN json_build_object('success', false);
  END IF;

  DELETE FROM admin_attempts WHERE attempted_at < NOW() - INTERVAL '1 hour';
  RETURN json_build_object('success', true);
END;
$$;

-- 6d. admin_create_token — insert a review-invite token (admin-only)
CREATE OR REPLACE FUNCTION admin_create_token(p_admin_code TEXT, p_source TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash TEXT;
  v_token RECORD;
BEGIN
  IF _check_admin_lockout() THEN
    RETURN json_build_object('success', false, 'error', 'Too many attempts. Try again in 15 minutes.');
  END IF;

  SELECT code_hash INTO v_hash FROM admin_config WHERE id = 1;
  IF v_hash IS NULL OR extensions.crypt(p_admin_code, v_hash) != v_hash THEN
    PERFORM _record_admin_failure();
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_source IS NULL OR p_source NOT IN (
    'commission','etsy','print','sticker','bookmark',
    'pet_portrait','faceless_portrait','coloring_book','general'
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Invalid source');
  END IF;

  INSERT INTO tokens (is_used, source, created_at, expires_at)
  VALUES (false, p_source, NOW(), NOW() + INTERVAL '30 days')
  RETURNING id, source, created_at, expires_at, is_used INTO v_token;

  RETURN json_build_object(
    'success', true,
    'token', json_build_object(
      'id', v_token.id,
      'source', v_token.source,
      'created_at', v_token.created_at,
      'expires_at', v_token.expires_at,
      'is_used', v_token.is_used
    )
  );
END;
$$;

-- 6e. admin_delete_token — remove a token (admin-only)
CREATE OR REPLACE FUNCTION admin_delete_token(p_admin_code TEXT, p_token_id TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash TEXT;
  v_deleted INT;
BEGIN
  IF _check_admin_lockout() THEN
    RETURN json_build_object('success', false, 'error', 'Too many attempts. Try again in 15 minutes.');
  END IF;

  SELECT code_hash INTO v_hash FROM admin_config WHERE id = 1;
  IF v_hash IS NULL OR extensions.crypt(p_admin_code, v_hash) != v_hash THEN
    PERFORM _record_admin_failure();
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_token_id IS NULL OR length(trim(p_token_id)) < 1 THEN
    RETURN json_build_object('success', false, 'error', 'Invalid token ID');
  END IF;

  DELETE FROM tokens WHERE id::text = trim(p_token_id);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Token not found');
  END IF;

  RETURN json_build_object('success', true);
END;
$$;

-- 6f. admin_change_code — change the admin password (requires current code)
CREATE OR REPLACE FUNCTION admin_change_code(
  p_current_code TEXT,
  p_new_code TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  IF _check_admin_lockout() THEN
    RETURN json_build_object('success', false, 'error', 'Too many attempts. Try again in 15 minutes.');
  END IF;

  SELECT code_hash INTO v_hash FROM admin_config WHERE id = 1;
  IF v_hash IS NULL OR extensions.crypt(p_current_code, v_hash) != v_hash THEN
    PERFORM _record_admin_failure();
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_new_code IS NULL OR length(trim(p_new_code)) < 4 THEN
    RETURN json_build_object('success', false, 'error', 'New code must be at least 4 characters');
  END IF;

  UPDATE admin_config
  SET code_hash = extensions.crypt(trim(p_new_code), extensions.gen_salt('bf'))
  WHERE id = 1;

  RETURN json_build_object('success', true);
END;
$$;


-- ============================================================================
-- PHASE 7: REVIEW SUBMISSION + DISCORD WEBHOOK
-- ============================================================================

-- 7a. submit_review — atomic review insert + token mark
CREATE OR REPLACE FUNCTION submit_review(
  p_token_id TEXT,
  p_client_name TEXT,
  p_review_text TEXT,
  p_rating INT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token RECORD;
  v_review_id BIGINT;
BEGIN
  IF p_token_id IS NULL OR length(trim(p_token_id)) < 1 THEN
    RETURN json_build_object('success', false, 'error', 'Invalid token');
  END IF;

  SELECT id, source, is_used, expires_at
  INTO v_token
  FROM tokens
  WHERE id::text = trim(p_token_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Invalid token');
  END IF;

  IF v_token.is_used THEN
    RETURN json_build_object('success', false, 'error', 'Token already used');
  END IF;

  IF v_token.expires_at IS NOT NULL AND v_token.expires_at < NOW() THEN
    RETURN json_build_object('success', false, 'error', 'Token expired');
  END IF;

  IF p_client_name IS NULL OR length(trim(p_client_name)) < 1 OR length(p_client_name) > 60 THEN
    RETURN json_build_object('success', false, 'error', 'Invalid name length');
  END IF;

  IF p_client_name !~ '^[a-zA-Z\s\.\-]+$' THEN
    RETURN json_build_object('success', false, 'error', 'Name contains invalid characters');
  END IF;

  IF p_review_text IS NULL OR length(trim(p_review_text)) < 1 OR length(p_review_text) > 280 THEN
    RETURN json_build_object('success', false, 'error', 'Invalid review text length');
  END IF;

  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RETURN json_build_object('success', false, 'error', 'Invalid rating');
  END IF;

  INSERT INTO reviews (client_name, review_text, rating, token_id, source)
  VALUES (
    trim(p_client_name),
    trim(p_review_text),
    p_rating,
    v_token.id,
    COALESCE(v_token.source, 'general')
  )
  RETURNING id INTO v_review_id;

  UPDATE tokens
  SET is_used = true, used_at = NOW()
  WHERE id = v_token.id AND is_used = false;

  RETURN json_build_object('success', true, 'review_id', v_review_id);
END;
$$;

-- 7b. Discord webhook notification on new review
CREATE OR REPLACE FUNCTION notify_discord_new_review()
RETURNS TRIGGER AS $$
DECLARE
  webhook_url TEXT := 'https://discord.com/api/webhooks/1469836557052678196/OQvIANXZrf5Fq_iao8irJoJZRLigruFPVJut-Aw0HZRRqcfqFlm2KwL_11j9QnZ4NfIP';
  dashboard_url TEXT := 'https://jossdraws.com/mgmt-7f8a2d9e.html#reviews';
  payload JSON;
BEGIN
  payload := json_build_object(
    'embeds', json_build_array(
      json_build_object(
        'title', '⭐ New Review — Tap to Approve',
        'url', dashboard_url,
        'color', 5814783,
        'fields', json_build_array(
          json_build_object('name', 'Client Name',  'value', COALESCE(NEW.client_name, 'Anonymous'), 'inline', true),
          json_build_object('name', 'Rating',        'value', COALESCE(NEW.rating::text, 'N/A') || ' ⭐', 'inline', true),
          json_build_object('name', 'Product Type',  'value', COALESCE(NEW.source, 'general'),        'inline', true),
          json_build_object('name', 'Review',        'value', COALESCE(NEW.review_text, 'No review text'), 'inline', false)
        ),
        'footer', json_build_object('text', 'Tap the title to open the Review Manager and approve'),
        'timestamp', NOW()
      )
    )
  );

  PERFORM net.http_post(
    url     := webhook_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := payload::jsonb
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the trigger (idempotent)
DROP TRIGGER IF EXISTS on_review_insert ON reviews;
CREATE TRIGGER on_review_insert
  AFTER INSERT ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION notify_discord_new_review();


-- ============================================================================
-- PHASE 7b: REVIEW MODERATION FUNCTIONS
-- ============================================================================

-- List all reviews grouped by status (admin-only)
CREATE OR REPLACE FUNCTION admin_list_reviews(p_admin_code TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_pending JSON;
  v_approved JSON;
  v_deleted JSON;
BEGIN
  IF _check_admin_lockout() THEN
    RETURN json_build_object('success', false, 'error', 'Too many attempts. Try again in 15 minutes.');
  END IF;

  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash)
    INTO v_is_admin FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    PERFORM _record_admin_failure();
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- Pending: not approved AND not deleted
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::json)
    INTO v_pending
    FROM (
      SELECT id, client_name, review_text, rating, source, created_at, is_approved
        FROM reviews
       WHERE (is_approved = false OR is_approved IS NULL)
         AND deleted_at IS NULL
    ) t;

  -- Approved: approved AND not deleted (ordered by sort_order for drag reorder)
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.review_sort_order ASC, t.created_at DESC), '[]'::json)
    INTO v_approved
    FROM (
      SELECT id, client_name, review_text, rating, source, created_at, is_approved, review_sort_order
        FROM reviews
       WHERE is_approved = true
         AND deleted_at IS NULL
    ) t;

  -- Deleted (trash): has deleted_at set
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.deleted_at DESC), '[]'::json)
    INTO v_deleted
    FROM (
      SELECT id, client_name, review_text, rating, source, created_at, is_approved, deleted_at
        FROM reviews
       WHERE deleted_at IS NOT NULL
    ) t;

  RETURN json_build_object(
    'success', true,
    'pending', v_pending,
    'approved', v_approved,
    'deleted', v_deleted
  );
END;
$$;

-- Approve review (publishes it)
CREATE OR REPLACE FUNCTION admin_approve_review(p_admin_code TEXT, p_review_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  IF _check_admin_lockout() THEN
    RETURN json_build_object('success', false, 'error', 'Too many attempts.');
  END IF;

  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash)
    INTO v_is_admin FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    PERFORM _record_admin_failure();
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- Assign next sort_order for approved list
  UPDATE reviews
     SET is_approved = true,
         deleted_at = NULL,
         review_sort_order = COALESCE(
           (SELECT MAX(review_sort_order) FROM reviews WHERE is_approved = true AND deleted_at IS NULL), 0
         ) + 1
   WHERE id = p_review_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Review not found');
  END IF;

  RETURN json_build_object('success', true);
END;
$$;

-- Deny review (un-publishes, moves to pending)
CREATE OR REPLACE FUNCTION admin_deny_review(p_admin_code TEXT, p_review_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  IF _check_admin_lockout() THEN
    RETURN json_build_object('success', false, 'error', 'Too many attempts.');
  END IF;

  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash)
    INTO v_is_admin FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    PERFORM _record_admin_failure();
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  UPDATE reviews
     SET is_approved = false
   WHERE id = p_review_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Review not found');
  END IF;

  RETURN json_build_object('success', true);
END;
$$;

-- Soft delete (move to trash)
CREATE OR REPLACE FUNCTION admin_delete_review(p_admin_code TEXT, p_review_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  IF _check_admin_lockout() THEN
    RETURN json_build_object('success', false, 'error', 'Too many attempts.');
  END IF;

  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash)
    INTO v_is_admin FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    PERFORM _record_admin_failure();
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  UPDATE reviews
     SET deleted_at = NOW(), is_approved = false
   WHERE id = p_review_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Review not found or already deleted');
  END IF;

  RETURN json_build_object('success', true);
END;
$$;

-- Restore from trash (sets to pending)
CREATE OR REPLACE FUNCTION admin_restore_review(p_admin_code TEXT, p_review_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  IF _check_admin_lockout() THEN
    RETURN json_build_object('success', false, 'error', 'Too many attempts.');
  END IF;

  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash)
    INTO v_is_admin FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    PERFORM _record_admin_failure();
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  UPDATE reviews
     SET deleted_at = NULL, is_approved = false
   WHERE id = p_review_id AND deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Review not found in trash');
  END IF;

  RETURN json_build_object('success', true);
END;
$$;

-- Permanent hard delete (purge from trash)
CREATE OR REPLACE FUNCTION admin_purge_review(p_admin_code TEXT, p_review_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_deleted INT;
BEGIN
  IF _check_admin_lockout() THEN
    RETURN json_build_object('success', false, 'error', 'Too many attempts.');
  END IF;

  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash)
    INTO v_is_admin FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    PERFORM _record_admin_failure();
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  DELETE FROM reviews WHERE id = p_review_id AND deleted_at IS NOT NULL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Review not found in trash');
  END IF;

  RETURN json_build_object('success', true);
END;
$$;


-- ============================================================================
-- PHASE 7c: REVIEW MOVE (drag-and-drop reorder for approved reviews)
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_move_review(
  p_admin_code TEXT,
  p_item_id    BIGINT,
  p_target_id  BIGINT,
  p_position   TEXT    -- 'before' or 'after'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin     BOOLEAN;
  v_old_order    INT;
  v_target_order INT;
  v_new_order    INT;
BEGIN
  IF _check_admin_lockout() THEN
    RETURN json_build_object('success', false, 'error', 'Too many attempts.');
  END IF;

  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash)
    INTO v_is_admin FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    PERFORM _record_admin_failure();
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT review_sort_order INTO v_old_order FROM reviews WHERE id = p_item_id;
  SELECT review_sort_order INTO v_target_order FROM reviews WHERE id = p_target_id;

  IF v_old_order IS NULL OR v_target_order IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Review not found');
  END IF;

  IF p_position = 'before' THEN
    v_new_order := v_target_order;
  ELSE
    v_new_order := v_target_order + 1;
  END IF;

  IF v_old_order < v_new_order THEN
    v_new_order := v_new_order - 1;
  END IF;

  IF v_old_order = v_new_order THEN
    RETURN json_build_object('success', true);
  END IF;

  IF v_old_order < v_new_order THEN
    UPDATE reviews SET review_sort_order = review_sort_order - 1
     WHERE review_sort_order > v_old_order AND review_sort_order <= v_new_order
       AND is_approved = true AND deleted_at IS NULL;
  ELSE
    UPDATE reviews SET review_sort_order = review_sort_order + 1
     WHERE review_sort_order >= v_new_order AND review_sort_order < v_old_order
       AND is_approved = true AND deleted_at IS NULL;
  END IF;

  UPDATE reviews SET review_sort_order = v_new_order WHERE id = p_item_id;

  RETURN json_build_object('success', true);
END;
$$;


-- ============================================================================
-- PHASE 7d: PUBLIC API — get_approved_reviews
-- ============================================================================
-- Returns only approved, non-deleted reviews ordered by sort_order.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_approved_reviews()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items JSON;
BEGIN
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    INTO v_items
    FROM (
      SELECT client_name, review_text, rating, created_at, source
        FROM reviews
       WHERE is_approved = true
         AND deleted_at IS NULL
       ORDER BY review_sort_order ASC, created_at DESC
       LIMIT 20
    ) t;

  RETURN json_build_object('success', true, 'reviews', v_items);
END;
$$;


-- ============================================================================
-- PHASE 8: GALLERY FUNCTION
-- ============================================================================

-- admin_move_gallery_item — drag-and-drop reorder for gallery
CREATE OR REPLACE FUNCTION admin_move_gallery_item(
  p_admin_code TEXT,
  p_item_id    BIGINT,
  p_target_id  BIGINT,
  p_position   TEXT    -- 'before' or 'after'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash         TEXT;
  v_old_order    INT;
  v_target_order INT;
  v_new_order    INT;
BEGIN
  IF _check_admin_lockout() THEN
    RETURN json_build_object('success', false, 'error', 'Too many attempts. Try again in 15 minutes.');
  END IF;

  SELECT code_hash INTO v_hash FROM admin_config WHERE id = 1;
  IF v_hash IS NULL OR extensions.crypt(p_admin_code, v_hash) != v_hash THEN
    PERFORM _record_admin_failure();
    RETURN json_build_object('success', false, 'error', 'Invalid admin code');
  END IF;

  SELECT sort_order INTO v_old_order    FROM gallery_items WHERE id = p_item_id;
  SELECT sort_order INTO v_target_order FROM gallery_items WHERE id = p_target_id;

  IF v_old_order IS NULL OR v_target_order IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Item not found');
  END IF;

  IF p_position = 'before' THEN
    v_new_order := v_target_order;
  ELSE
    v_new_order := v_target_order + 1;
  END IF;

  IF v_old_order < v_new_order THEN
    v_new_order := v_new_order - 1;
  END IF;

  IF v_old_order = v_new_order THEN
    RETURN json_build_object('success', true);
  END IF;

  IF v_old_order < v_new_order THEN
    UPDATE gallery_items SET sort_order = sort_order - 1
     WHERE sort_order > v_old_order AND sort_order <= v_new_order;
  ELSE
    UPDATE gallery_items SET sort_order = sort_order + 1
     WHERE sort_order >= v_new_order AND sort_order < v_old_order;
  END IF;

  UPDATE gallery_items SET sort_order = v_new_order WHERE id = p_item_id;

  RETURN json_build_object('success', true);
END;
$$;


-- ============================================================================
-- PHASE 9: HERO SLIDE FUNCTIONS (full CRUD + reorder)
-- ============================================================================

-- LIST (all slides including hidden — for admin UI)
CREATE OR REPLACE FUNCTION admin_list_hero_slides(p_admin_code TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_items JSON;
BEGIN
  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash) INTO v_is_admin
    FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', 'Invalid admin code');
  END IF;

  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_items
    FROM (
      SELECT id, img_url, sort_order, is_active, created_at, updated_at
        FROM hero_slides
       ORDER BY sort_order ASC, created_at DESC
    ) t;

  RETURN json_build_object('success', true, 'items', v_items);
END;
$$;

-- ADD SLIDE
CREATE OR REPLACE FUNCTION admin_add_hero_slide(
  p_admin_code TEXT,
  p_img_url    TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_max_sort INT;
BEGIN
  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash) INTO v_is_admin
    FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', 'Invalid admin code');
  END IF;

  SELECT COALESCE(MAX(sort_order), 0) INTO v_max_sort FROM hero_slides;

  INSERT INTO hero_slides (img_url, sort_order)
  VALUES (p_img_url, v_max_sort + 1);

  RETURN json_build_object('success', true);
END;
$$;

-- TOGGLE ACTIVE / HIDDEN
CREATE OR REPLACE FUNCTION admin_toggle_hero_slide(
  p_admin_code TEXT,
  p_slide_id   BIGINT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin  BOOLEAN;
  v_new_state BOOLEAN;
BEGIN
  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash) INTO v_is_admin
    FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', 'Invalid admin code');
  END IF;

  UPDATE hero_slides
     SET is_active   = NOT is_active,
         updated_at  = NOW()
   WHERE id = p_slide_id
  RETURNING is_active INTO v_new_state;

  IF v_new_state IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Slide not found');
  END IF;

  RETURN json_build_object('success', true, 'is_active', v_new_state);
END;
$$;

-- DELETE SLIDE
CREATE OR REPLACE FUNCTION admin_delete_hero_slide(
  p_admin_code TEXT,
  p_slide_id   BIGINT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_found    BOOLEAN;
BEGIN
  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash) INTO v_is_admin
    FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', 'Invalid admin code');
  END IF;

  DELETE FROM hero_slides WHERE id = p_slide_id;
  GET DIAGNOSTICS v_found = ROW_COUNT;

  IF NOT v_found THEN
    RETURN json_build_object('success', false, 'error', 'Slide not found');
  END IF;

  RETURN json_build_object('success', true);
END;
$$;

-- EDIT SLIDE (update URL and/or visibility)
CREATE OR REPLACE FUNCTION admin_edit_hero_slide(
  p_admin_code TEXT,
  p_slide_id   BIGINT,
  p_img_url    TEXT,
  p_is_active  BOOLEAN DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash) INTO v_is_admin
    FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', 'Invalid admin code');
  END IF;

  UPDATE hero_slides
     SET img_url    = COALESCE(p_img_url, img_url),
         is_active  = COALESCE(p_is_active, is_active),
         updated_at = NOW()
   WHERE id = p_slide_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Slide not found');
  END IF;

  RETURN json_build_object('success', true);
END;
$$;

-- MOVE / REORDER (insert-before / insert-after)
CREATE OR REPLACE FUNCTION admin_move_hero_slide(
  p_admin_code TEXT,
  p_item_id    BIGINT,
  p_target_id  BIGINT,
  p_position   TEXT    -- 'before' or 'after'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin     BOOLEAN;
  v_old_order    INT;
  v_target_order INT;
  v_new_order    INT;
BEGIN
  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash) INTO v_is_admin
    FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', 'Invalid admin code');
  END IF;

  SELECT sort_order INTO v_old_order    FROM hero_slides WHERE id = p_item_id;
  SELECT sort_order INTO v_target_order FROM hero_slides WHERE id = p_target_id;

  IF v_old_order IS NULL OR v_target_order IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Slide not found');
  END IF;

  IF p_position = 'before' THEN
    v_new_order := v_target_order;
  ELSE
    v_new_order := v_target_order + 1;
  END IF;

  IF v_old_order < v_new_order THEN
    v_new_order := v_new_order - 1;
  END IF;

  IF v_old_order = v_new_order THEN
    RETURN json_build_object('success', true);
  END IF;

  IF v_old_order < v_new_order THEN
    UPDATE hero_slides SET sort_order = sort_order - 1
     WHERE sort_order > v_old_order AND sort_order <= v_new_order;
  ELSE
    UPDATE hero_slides SET sort_order = sort_order + 1
     WHERE sort_order >= v_new_order AND sort_order < v_old_order;
  END IF;

  UPDATE hero_slides SET sort_order = v_new_order, updated_at = NOW()
   WHERE id = p_item_id;

  RETURN json_build_object('success', true);
END;
$$;

-- REORDER BY POSITION NUMBER
CREATE OR REPLACE FUNCTION admin_reorder_hero_slide(
  p_admin_code    TEXT,
  p_item_id       BIGINT,
  p_new_sort_order INT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin  BOOLEAN;
  v_old_order INT;
  v_max_order INT;
BEGIN
  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash) INTO v_is_admin
    FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', 'Invalid admin code');
  END IF;

  SELECT sort_order INTO v_old_order FROM hero_slides WHERE id = p_item_id;
  IF v_old_order IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Slide not found');
  END IF;

  SELECT COALESCE(MAX(sort_order), 1) INTO v_max_order FROM hero_slides;

  IF p_new_sort_order < 1 THEN p_new_sort_order := 1; END IF;
  IF p_new_sort_order > v_max_order THEN p_new_sort_order := v_max_order; END IF;

  IF v_old_order = p_new_sort_order THEN
    RETURN json_build_object('success', true);
  END IF;

  IF v_old_order < p_new_sort_order THEN
    UPDATE hero_slides SET sort_order = sort_order - 1
     WHERE sort_order > v_old_order AND sort_order <= p_new_sort_order;
  ELSE
    UPDATE hero_slides SET sort_order = sort_order + 1
     WHERE sort_order >= p_new_sort_order AND sort_order < v_old_order;
  END IF;

  UPDATE hero_slides SET sort_order = p_new_sort_order, updated_at = NOW()
   WHERE id = p_item_id;

  RETURN json_build_object('success', true);
END;
$$;


-- ============================================================================
-- PHASE 10: SHOP ITEM FUNCTIONS (full CRUD + reorder)
-- ============================================================================

-- LIST (all items including hidden — for admin UI)
CREATE OR REPLACE FUNCTION admin_list_shop_items(p_admin_code TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_items JSON;
BEGIN
  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash) INTO v_is_admin
    FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_items
    FROM (
      SELECT id, title, price_display, etsy_url, section_label, media,
             is_active, sort_order, created_at, updated_at
        FROM shop_items
       ORDER BY sort_order ASC, created_at DESC
    ) t;

  RETURN json_build_object('success', true, 'items', v_items);
END;
$$;

-- ADD ITEM
CREATE OR REPLACE FUNCTION admin_add_shop_item(
  p_admin_code    TEXT,
  p_title         TEXT,
  p_price_display TEXT,
  p_etsy_url      TEXT,
  p_section_label TEXT DEFAULT '',
  p_media         JSONB DEFAULT '[]'::jsonb,
  p_is_active     BOOLEAN DEFAULT true,
  p_sort_order    INT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_max_sort INT;
  v_final_sort INT;
BEGIN
  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash) INTO v_is_admin
    FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_title IS NULL OR length(trim(p_title)) < 1 THEN
    RETURN json_build_object('success', false, 'error', 'Title is required');
  END IF;

  IF p_price_display IS NULL OR length(trim(p_price_display)) < 1 THEN
    RETURN json_build_object('success', false, 'error', 'Price is required');
  END IF;

  IF p_etsy_url IS NULL OR length(trim(p_etsy_url)) < 1 THEN
    RETURN json_build_object('success', false, 'error', 'Etsy URL is required');
  END IF;

  SELECT COALESCE(MAX(sort_order), 0) INTO v_max_sort FROM shop_items;
  v_final_sort := COALESCE(p_sort_order, v_max_sort + 1);

  INSERT INTO shop_items (title, price_display, etsy_url, section_label, media, is_active, sort_order)
  VALUES (p_title, p_price_display, p_etsy_url, COALESCE(p_section_label, ''), p_media, p_is_active, v_final_sort);

  RETURN json_build_object('success', true);
END;
$$;

-- EDIT ITEM
CREATE OR REPLACE FUNCTION admin_edit_shop_item(
  p_admin_code    TEXT,
  p_item_id       BIGINT,
  p_title         TEXT DEFAULT NULL,
  p_price_display TEXT DEFAULT NULL,
  p_etsy_url      TEXT DEFAULT NULL,
  p_section_label TEXT DEFAULT NULL,
  p_media         JSONB DEFAULT NULL,
  p_is_active     BOOLEAN DEFAULT NULL,
  p_sort_order    INT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash) INTO v_is_admin
    FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  UPDATE shop_items
     SET title         = COALESCE(p_title, title),
         price_display = COALESCE(p_price_display, price_display),
         etsy_url      = COALESCE(p_etsy_url, etsy_url),
         section_label = COALESCE(p_section_label, section_label),
         media         = COALESCE(p_media, media),
         is_active     = COALESCE(p_is_active, is_active),
         sort_order    = COALESCE(p_sort_order, sort_order),
         updated_at    = NOW()
   WHERE id = p_item_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Item not found');
  END IF;

  RETURN json_build_object('success', true);
END;
$$;

-- TOGGLE ACTIVE / HIDDEN
CREATE OR REPLACE FUNCTION admin_toggle_shop_item(
  p_admin_code TEXT,
  p_item_id    BIGINT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin  BOOLEAN;
  v_new_state BOOLEAN;
BEGIN
  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash) INTO v_is_admin
    FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  UPDATE shop_items
     SET is_active   = NOT is_active,
         updated_at  = NOW()
   WHERE id = p_item_id
  RETURNING is_active INTO v_new_state;

  IF v_new_state IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Item not found');
  END IF;

  RETURN json_build_object('success', true, 'is_active', v_new_state);
END;
$$;

-- DELETE ITEM
CREATE OR REPLACE FUNCTION admin_delete_shop_item(
  p_admin_code TEXT,
  p_item_id    BIGINT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_found    BOOLEAN;
BEGIN
  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash) INTO v_is_admin
    FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  DELETE FROM shop_items WHERE id = p_item_id;
  GET DIAGNOSTICS v_found = ROW_COUNT;

  IF NOT v_found THEN
    RETURN json_build_object('success', false, 'error', 'Item not found');
  END IF;

  RETURN json_build_object('success', true);
END;
$$;

-- MOVE / REORDER (insert-before / insert-after via drag-and-drop)
CREATE OR REPLACE FUNCTION admin_move_shop_item(
  p_admin_code TEXT,
  p_item_id    BIGINT,
  p_target_id  BIGINT,
  p_position   TEXT    -- 'before' or 'after'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin     BOOLEAN;
  v_old_order    INT;
  v_target_order INT;
  v_new_order    INT;
BEGIN
  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash) INTO v_is_admin
    FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT sort_order INTO v_old_order    FROM shop_items WHERE id = p_item_id;
  SELECT sort_order INTO v_target_order FROM shop_items WHERE id = p_target_id;

  IF v_old_order IS NULL OR v_target_order IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Item not found');
  END IF;

  IF p_position = 'before' THEN
    v_new_order := v_target_order;
  ELSE
    v_new_order := v_target_order + 1;
  END IF;

  IF v_old_order < v_new_order THEN
    v_new_order := v_new_order - 1;
  END IF;

  IF v_old_order = v_new_order THEN
    RETURN json_build_object('success', true);
  END IF;

  IF v_old_order < v_new_order THEN
    UPDATE shop_items SET sort_order = sort_order - 1
     WHERE sort_order > v_old_order AND sort_order <= v_new_order;
  ELSE
    UPDATE shop_items SET sort_order = sort_order + 1
     WHERE sort_order >= v_new_order AND sort_order < v_old_order;
  END IF;

  UPDATE shop_items SET sort_order = v_new_order, updated_at = NOW()
   WHERE id = p_item_id;

  RETURN json_build_object('success', true);
END;
$$;

-- REORDER BY POSITION NUMBER
CREATE OR REPLACE FUNCTION admin_reorder_shop_item(
  p_admin_code     TEXT,
  p_item_id        BIGINT,
  p_new_sort_order INT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin  BOOLEAN;
  v_old_order INT;
  v_max_order INT;
BEGIN
  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash) INTO v_is_admin
    FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT sort_order INTO v_old_order FROM shop_items WHERE id = p_item_id;
  IF v_old_order IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Item not found');
  END IF;

  SELECT COALESCE(MAX(sort_order), 1) INTO v_max_order FROM shop_items;

  IF p_new_sort_order < 1 THEN p_new_sort_order := 1; END IF;
  IF p_new_sort_order > v_max_order THEN p_new_sort_order := v_max_order; END IF;

  IF v_old_order = p_new_sort_order THEN
    RETURN json_build_object('success', true);
  END IF;

  IF v_old_order < p_new_sort_order THEN
    UPDATE shop_items SET sort_order = sort_order - 1
     WHERE sort_order > v_old_order AND sort_order <= p_new_sort_order;
  ELSE
    UPDATE shop_items SET sort_order = sort_order + 1
     WHERE sort_order >= p_new_sort_order AND sort_order < v_old_order;
  END IF;

  UPDATE shop_items SET sort_order = p_new_sort_order, updated_at = NOW()
   WHERE id = p_item_id;

  RETURN json_build_object('success', true);
END;
$$;


-- ============================================================================
-- PHASE 11: SHOP PAGE TITLE FUNCTIONS
-- ============================================================================

-- Admin GET page titles
CREATE OR REPLACE FUNCTION admin_get_shop_page_titles(p_admin_code TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_titles JSONB;
BEGIN
  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash) INTO v_is_admin
    FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT COALESCE(shop_page_titles, '[]'::jsonb) INTO v_titles
    FROM admin_config WHERE id = 1;

  RETURN json_build_object('success', true, 'titles', v_titles);
END;
$$;

-- Admin SET page titles
CREATE OR REPLACE FUNCTION admin_set_shop_page_titles(
  p_admin_code TEXT,
  p_titles     JSONB
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash) INTO v_is_admin
    FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF jsonb_typeof(p_titles) != 'array' THEN
    RETURN json_build_object('success', false, 'error', 'Titles must be a JSON array');
  END IF;

  UPDATE admin_config
     SET shop_page_titles = p_titles
   WHERE id = 1;

  RETURN json_build_object('success', true);
END;
$$;


-- ============================================================================
-- PHASE 12: PUBLIC API — get_active_shop_items (FINAL version w/ page_titles)
-- ============================================================================
-- Returns active items + admin-configured page titles. No auth required.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_active_shop_items()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items JSON;
  v_titles JSONB;
BEGIN
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_items
    FROM (
      SELECT id, title, price_display, etsy_url, media, sort_order
        FROM shop_items
       WHERE is_active = true
       ORDER BY sort_order ASC, created_at DESC
    ) t;

  SELECT COALESCE(shop_page_titles, '[]'::jsonb) INTO v_titles
    FROM admin_config WHERE id = 1;

  RETURN json_build_object('success', true, 'items', v_items, 'page_titles', v_titles);
END;
$$;


-- ============================================================================
-- PHASE 12b: ABOUT CONTENT FUNCTIONS
-- ============================================================================

-- Admin GET about content
CREATE OR REPLACE FUNCTION admin_get_about_content(p_admin_code TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_photo TEXT;
  v_bio TEXT;
BEGIN
  IF _check_admin_lockout() THEN
    RETURN json_build_object('success', false, 'error', 'Too many attempts.');
  END IF;

  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash)
    INTO v_is_admin FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    PERFORM _record_admin_failure();
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT about_photo_url, about_bio_text
    INTO v_photo, v_bio
    FROM admin_config WHERE id = 1;

  RETURN json_build_object('success', true, 'photo_url', v_photo, 'bio_text', v_bio);
END;
$$;

-- Admin SET about content
CREATE OR REPLACE FUNCTION admin_set_about_content(
  p_admin_code TEXT,
  p_photo_url TEXT,
  p_bio_text TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  IF _check_admin_lockout() THEN
    RETURN json_build_object('success', false, 'error', 'Too many attempts.');
  END IF;

  SELECT (code_hash IS NOT NULL AND extensions.crypt(p_admin_code, code_hash) = code_hash)
    INTO v_is_admin FROM admin_config WHERE id = 1;

  IF v_is_admin IS NOT TRUE THEN
    PERFORM _record_admin_failure();
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  UPDATE admin_config
     SET about_photo_url = COALESCE(NULLIF(trim(p_photo_url), ''), about_photo_url),
         about_bio_text  = COALESCE(p_bio_text, about_bio_text)
   WHERE id = 1;

  RETURN json_build_object('success', true);
END;
$$;

-- Public GET about content (no auth)
CREATE OR REPLACE FUNCTION get_about_content()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_photo TEXT;
  v_bio TEXT;
BEGIN
  SELECT about_photo_url, about_bio_text
    INTO v_photo, v_bio
    FROM admin_config WHERE id = 1;

  RETURN json_build_object('success', true, 'photo_url', v_photo, 'bio_text', v_bio);
END;
$$;


-- ============================================================================
-- PHASE 13: SEED DATA (only if shop_items is empty)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM shop_items LIMIT 1) THEN

    INSERT INTO shop_items (title, price_display, etsy_url, section_label, media, is_active, sort_order) VALUES
    (
      'Custom Pet Portrait',
      '$80.00+',
      'https://www.etsy.com/listing/1517173888/custom-pet-portrait',
      'Best sellers',
      '["https://i.etsystatic.com/25958263/r/il/015511/5965017745/il_794xN.5965017745_b06b.jpg","https://i.etsystatic.com/25958263/r/il/113a9c/5970375331/il_794xN.5970375331_e4vt.jpg","https://i.etsystatic.com/25958263/r/il/422260/5922290370/il_794xN.5922290370_4j19.jpg","https://i.etsystatic.com/25958263/r/il/02b227/5762088387/il_1140xN.5762088387_lsw8.jpg","https://i.etsystatic.com/25958263/r/il/cc43cf/5714027494/il_1140xN.5714027494_cwah.jpg","https://i.etsystatic.com/25958263/r/il/dfac4d/5970378481/il_1140xN.5970378481_lmrg.jpg","https://i.etsystatic.com/25958263/r/il/098190/5714027910/il_1140xN.5714027910_4y00.jpg","https://i.etsystatic.com/25958263/r/il/b6be33/5970377781/il_1140xN.5970377781_scf1.jpg","https://i.etsystatic.com/25958263/r/il/c58d78/5762088139/il_1140xN.5762088139_e2zr.jpg"]'::jsonb,
      true,
      1
    ),
    (
      'Bugs & Blossoms - Coloring Book',
      '$23.50',
      'https://www.etsy.com/listing/4391097322/bugs-blossoms-coloring-book',
      'Best sellers',
      '["https://i.etsystatic.com/25958263/r/il/b95b4f/7362253835/il_1140xN.7362253835_4a4u.jpg","https://v.etsystatic.com/video/upload/ac_none,du_15,q_auto:good/file_uapxzl.mp4","https://i.etsystatic.com/25958263/r/il/5a2cd7/7362252905/il_794xN.7362252905_7f97.jpg","https://i.etsystatic.com/25958263/r/il/5548ce/7314294768/il_1140xN.7314294768_8z7l.jpg","https://i.etsystatic.com/25958263/r/il/de0543/7362252909/il_1140xN.7362252909_tqib.jpg"]'::jsonb,
      true,
      2
    ),
    (
      'Faceless portraits',
      '$79.00+',
      'https://www.etsy.com/listing/1517686781/faceless-portrait-printed-on-canvas',
      'Best sellers',
      '["https://lh3.googleusercontent.com/d/16euNg2ICjjUo9f_3dCspbOeqGbhtHVel","https://lh3.googleusercontent.com/d/17ZzvUNf14RbIc73L6nyI5tHMWihVQEtQ","https://lh3.googleusercontent.com/d/1psLbjms-CQRyLp0TVi5IHPbdoUerxja6","https://lh3.googleusercontent.com/d/1iksM3-0qlCySUIK7R2E9RlfIkdKEmjIq","https://lh3.googleusercontent.com/d/1Qe10C5JpGft_hqXbIZpUigLJjJKsHrq1","https://lh3.googleusercontent.com/d/1YAXeJ6BsspIEusB5IsdNsEEMVP_4bb4O","https://lh3.googleusercontent.com/d/1EjTWxEtG_5s6vSNTcynGUpakSN9msXeU"]'::jsonb,
      true,
      3
    ),
    (
      'Art Prints',
      '$18.00',
      'https://www.etsy.com/shop/JossDrawsLLC?section_id=32688825',
      'page 2',
      '["https://i.etsystatic.com/25958263/r/il/f6853e/5174654859/il_1140xN.5174654859_1vh1.jpg","https://i.etsystatic.com/25958263/r/il/3d5a55/3285883702/il_1140xN.3285883702_qj40.jpg","https://i.etsystatic.com/25958263/r/il/e30bd6/3420988914/il_1140xN.3420988914_1r8e.jpg","https://i.etsystatic.com/25958263/r/il/50c61b/2953794688/il_1140xN.2953794688_ooj1.jpg"]'::jsonb,
      true,
      4
    ),
    (
      'Stickers',
      '$2.75+',
      'https://www.etsy.com/shop/JossDrawsLLC?section_id=32672192',
      'Page 2',
      '["https://i.etsystatic.com/25958263/r/il/232611/6104053343/il_1140xN.6104053343_7ady.jpg","https://i.etsystatic.com/25958263/r/il/962517/6055085414/il_1140xN.6055085414_3dtq.jpg","https://i.etsystatic.com/25958263/r/il/3d154b/6055085550/il_1140xN.6055085550_tewj.jpg","https://i.etsystatic.com/25958263/r/il/4cf967/6104042909/il_1140xN.6104042909_6vqy.jpg","https://i.etsystatic.com/25958263/r/il/399dd6/6459740696/il_1140xN.6459740696_j19g.jpg","https://i.etsystatic.com/25958263/r/il/8ca627/6103142173/il_1140xN.6103142173_fgqa.jpg","https://i.etsystatic.com/25958263/r/il/49d43b/6104046985/il_1140xN.6104046985_q64a.jpg","https://i.etsystatic.com/25958263/r/il/dc1728/6055821626/il_1140xN.6055821626_70lf.jpg","https://i.etsystatic.com/25958263/r/il/729698/6055819612/il_1140xN.6055819612_e53f.jpg","https://i.etsystatic.com/25958263/r/il/41d541/6055993106/il_1140xN.6055993106_dxta.jpg","https://i.etsystatic.com/25958263/r/il/e320af/6105024551/il_1140xN.6105024551_kt31.jpg","https://i.etsystatic.com/25958263/r/il/71ac50/6104052719/il_1140xN.6104052719_a31o.jpg"]'::jsonb,
      true,
      5
    ),
    (
      'Bookmarks',
      '$8.00',
      'https://www.etsy.com/shop/JossDrawsLLC?section_id=34093055',
      'Pinned',
      '["https://i.etsystatic.com/25958263/r/il/39da5a/5914582142/il_1140xN.5914582142_o6dx.jpg","https://i.etsystatic.com/25958263/r/il/ee1668/5914577438/il_1140xN.5914577438_ntqp.jpg","https://i.etsystatic.com/25958263/r/il/5f631a/6122024532/il_1140xN.6122024532_8xwr.jpg"]'::jsonb,
      true,
      6
    );

    RAISE NOTICE 'Seeded 6 shop items from hardcoded index.html data';
  ELSE
    RAISE NOTICE 'shop_items table already has data — skipping seed';
  END IF;
END $$;


-- ============================================================================
-- PHASE 14: GRANTS — public access to RPCs
-- ============================================================================

GRANT EXECUTE ON FUNCTION submit_review(TEXT, TEXT, TEXT, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_admin(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_create_token(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_token(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_change_code(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_list_reviews(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_approve_review(TEXT, BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_deny_review(TEXT, BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_review(TEXT, BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_restore_review(TEXT, BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_purge_review(TEXT, BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_move_review(TEXT, BIGINT, BIGINT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_get_about_content(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_set_about_content(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_about_content() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_approved_reviews() TO anon, authenticated;

-- Gallery
GRANT EXECUTE ON FUNCTION admin_move_gallery_item(TEXT, BIGINT, BIGINT, TEXT) TO anon, authenticated;

-- Hero slides
GRANT EXECUTE ON FUNCTION admin_list_hero_slides(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_add_hero_slide(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_toggle_hero_slide(TEXT, BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_hero_slide(TEXT, BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_edit_hero_slide(TEXT, BIGINT, TEXT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_move_hero_slide(TEXT, BIGINT, BIGINT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_reorder_hero_slide(TEXT, BIGINT, INT) TO anon, authenticated;

-- Shop items
GRANT EXECUTE ON FUNCTION admin_list_shop_items(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_add_shop_item(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_edit_shop_item(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_toggle_shop_item(TEXT, BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_shop_item(TEXT, BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_move_shop_item(TEXT, BIGINT, BIGINT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_reorder_shop_item(TEXT, BIGINT, INT) TO anon, authenticated;

-- Shop page titles
GRANT EXECUTE ON FUNCTION admin_get_shop_page_titles(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_set_shop_page_titles(TEXT, JSONB) TO anon, authenticated;

-- Public API
GRANT EXECUTE ON FUNCTION get_active_shop_items() TO anon, authenticated;


-- ============================================================================
-- PHASE 15: VERIFY EVERYTHING
-- ============================================================================

-- Force PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';

-- Check ALL managed functions exist
SELECT p.proname,
       p.prosecdef AS security_definer,
       pg_get_function_arguments(p.oid) AS parameters
FROM pg_proc p
WHERE p.proname IN (
        'submit_review', 'notify_discord_new_review',
        '_check_admin_lockout', '_record_admin_failure',
        'verify_admin', 'admin_create_token', 'admin_delete_token', 'admin_change_code',
        'admin_move_gallery_item',
        'admin_list_hero_slides', 'admin_add_hero_slide', 'admin_toggle_hero_slide',
        'admin_delete_hero_slide', 'admin_edit_hero_slide',
        'admin_move_hero_slide', 'admin_reorder_hero_slide',
        'admin_list_shop_items', 'admin_add_shop_item', 'admin_edit_shop_item',
        'admin_toggle_shop_item', 'admin_delete_shop_item',
        'admin_move_shop_item', 'admin_reorder_shop_item',
        'admin_get_shop_page_titles', 'admin_set_shop_page_titles',
        'get_active_shop_items',
        'admin_list_reviews', 'admin_approve_review', 'admin_deny_review',
        'admin_delete_review', 'admin_restore_review', 'admin_purge_review',
        'admin_move_review',
        'admin_get_about_content', 'admin_set_about_content',
        'get_about_content', 'get_approved_reviews'
      )
  AND p.pronamespace = 'public'::regnamespace
ORDER BY p.proname;

-- Check constraints
SELECT conname, conrelid::regclass AS table_name, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN ('reviews'::regclass, 'tokens'::regclass)
  AND contype = 'c'
ORDER BY conrelid, conname;

-- Check RLS policies
SELECT tablename, policyname, cmd, roles::text
FROM pg_policies
WHERE tablename IN ('reviews', 'tokens', 'admin_config', 'admin_attempts', 'hero_slides', 'shop_items')
ORDER BY tablename, policyname;

-- Show column types for key tables
SELECT table_name, column_name, data_type, udt_name
FROM information_schema.columns
WHERE (table_name = 'tokens' AND column_name = 'id')
   OR (table_name = 'reviews' AND column_name = 'id')
   OR (table_name = 'hero_slides' AND column_name = 'id')
   OR (table_name = 'shop_items' AND column_name = 'id')
ORDER BY table_name;

-- Check shop_page_titles + about columns
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'admin_config'
  AND column_name IN ('shop_page_titles', 'about_photo_url', 'about_bio_text');

-- Check Discord trigger
SELECT tgname AS trigger_name,
       tgrelid::regclass AS table_name,
       proname AS function_name
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE tgrelid = 'reviews'::regclass
  AND NOT tgisinternal
ORDER BY tgname;

-- Show seeded data count
SELECT COUNT(*) AS shop_item_count FROM shop_items;

-- Show table structure for shop_items
SELECT column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'shop_items'
ORDER BY ordinal_position;
