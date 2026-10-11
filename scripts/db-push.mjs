/**
 * Ensures new tables/columns exist after each deploy.
 * Uses DATABASE_URL / NEON_DATABASE_URL — no interactive drizzle-kit needed.
 */
import pg from "pg";

const url = (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || "").trim();
if (!url) {
  console.warn("[db-push] No DATABASE_URL — skip schema push");
  process.exit(0);
}

const client = new pg.Client({
  connectionString: url,
  ssl: /neon\.tech|sslmode=require/i.test(url) ? { rejectUnauthorized: false } : undefined,
});

const SQL = `
CREATE SCHEMA IF NOT EXISTS spaceprs;

CREATE TABLE IF NOT EXISTS spaceprs.user_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id uuid NOT NULL REFERENCES spaceprs.users(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES spaceprs.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_follows_uq ON spaceprs.user_follows (follower_id, following_id);
CREATE INDEX IF NOT EXISTS user_follows_following_idx ON spaceprs.user_follows (following_id);

CREATE TABLE IF NOT EXISTS spaceprs.preset_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES spaceprs.users(id) ON DELETE CASCADE,
  preset_id uuid NOT NULL REFERENCES spaceprs.presets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS preset_favorites_uq ON spaceprs.preset_favorites (user_id, preset_id);
CREATE INDEX IF NOT EXISTS preset_favorites_user_idx ON spaceprs.preset_favorites (user_id);

CREATE TABLE IF NOT EXISTS spaceprs.preset_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_id uuid NOT NULL REFERENCES spaceprs.presets(id) ON DELETE CASCADE,
  viewer_id uuid REFERENCES spaceprs.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS preset_views_preset_idx ON spaceprs.preset_views (preset_id);

CREATE TABLE IF NOT EXISTS spaceprs.user_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES spaceprs.users(id) ON DELETE CASCADE,
  preset_id uuid REFERENCES spaceprs.presets(id) ON DELETE SET NULL,
  title text NOT NULL,
  caption text,
  video_url text NOT NULL,
  thumbnail_url text,
  xml_url text,
  five_mb_url text,
  status text NOT NULL DEFAULT 'published',
  view_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_uploads_user_idx ON spaceprs.user_uploads (user_id);
CREATE INDEX IF NOT EXISTS user_uploads_created_idx ON spaceprs.user_uploads (created_at);

ALTER TABLE spaceprs.presets ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0;
ALTER TABLE spaceprs.presets ADD COLUMN IF NOT EXISTS favorite_count integer NOT NULL DEFAULT 0;
ALTER TABLE spaceprs.presets ADD COLUMN IF NOT EXISTS uploader_user_id uuid REFERENCES spaceprs.users(id) ON DELETE SET NULL;
`;

try {
  await client.connect();
  await client.query(SQL);
  console.log("[db-push] Schema OK (tables/columns ensured)");
} catch (err) {
  console.error("[db-push] Failed:", err?.message || err);
} finally {
  try {
    await client.end();
  } catch {
    /* ignore */
  }
}
