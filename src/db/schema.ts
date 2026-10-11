import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * All Preset Space tables live in their own PostgreSQL schema so the app can
 * share a Neon database with other projects without any name collisions.
 */
export const presetSpace = pgSchema("spaceprs");
const pgTable = presetSpace.table;

/* ------------------------------------------------------------------ users */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    email: text("email"),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    avatarKey: text("avatar_key").notNull().default("neon-01"),
    avatarUrl: text("avatar_url"),
    role: text("role").notNull().default("user"), // user | admin | developer
    status: text("status").notNull().default("active"), // active | banned
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("users_username_uq").on(t.username),
    uniqueIndex("users_email_uq").on(t.email),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256 of the raw cookie token
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

/* --------------------------------------------------------- tiktok objects */

export const creators = pgTable(
  "creators",
  {
    id: serial("id").primaryKey(),
    uniqueId: text("unique_id").notNull(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    profileUrl: text("profile_url"),
    verified: boolean("verified").notNull().default(false),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("creators_unique_id_uq").on(t.uniqueId)],
);

export const sounds = pgTable(
  "sounds",
  {
    id: serial("id").primaryKey(),
    tiktokId: text("tiktok_id"),
    title: text("title"),
    authorName: text("author_name"),
    url: text("url"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sounds_url_uq").on(t.url), index("sounds_title_idx").on(t.title)],
);

export const presetCategories = pgTable(
  "preset_categories",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    labelCn: text("label_cn"),
    description: text("description"),
    keywords: text("keywords").array().notNull().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("preset_categories_slug_uq").on(t.slug)],
);

export const presets = pgTable(
  "presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tiktokId: text("tiktok_id").notNull(),
    videoUrl: text("video_url").notNull(),
    embedUrl: text("embed_url"),
    thumbnailUrl: text("thumbnail_url"),
    playableUrl: text("playable_url"),
    playableSource: text("playable_source"),
    playableExpiresAt: timestamp("playable_expires_at", { withTimezone: true }),
    title: text("title"),
    caption: text("caption"),
    hashtags: text("hashtags").array().notNull().default([]),
    keywords: text("keywords").array().notNull().default([]),
    creatorId: integer("creator_id").references(() => creators.id, { onDelete: "set null" }),
    soundId: integer("sound_id").references(() => sounds.id, { onDelete: "set null" }),
    categoryId: integer("category_id").references(() => presetCategories.id, {
      onDelete: "set null",
    }),
    durationSec: integer("duration_sec"),
    stats: jsonb("stats").$type<{
      plays?: number | null;
      likes?: number | null;
      comments?: number | null;
      shares?: number | null;
    }>(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // scanner status fields
    xmlStatus: text("xml_status").notNull().default("PENDING"), // FOUND|PENDING|COMMENTS_UNAVAILABLE|RETRY_PENDING|FAILED
    fiveMbStatus: text("five_mb_status").notNull().default("PENDING"),
    overallStatus: text("overall_status").notNull().default("NEW"), // NEW|SCANNING|PARTIAL|XML_FOUND|FIVE_MB_FOUND|COMPLETE|RETRY_PENDING|SOURCE_UNAVAILABLE|FAILED
    confidence: integer("confidence").notNull().default(0),
    xmlUrl: text("xml_url"),
    fiveMbUrl: text("five_mb_url"),
    xmlSource: text("xml_source"),
    fiveMbSource: text("five_mb_source"),
    lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    scanAttempts: integer("scan_attempts").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),
    favoriteCount: integer("favorite_count").notNull().default(0),
    uploaderUserId: uuid("uploader_user_id").references(() => users.id, { onDelete: "set null" }),
    scanError: text("scan_error"),
    discoverySource: text("discovery_source").notNull().default("manual"), // keyword_search|url_submit|creator_scan|manual
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("presets_tiktok_id_uq").on(t.tiktokId),
    index("presets_creator_idx").on(t.creatorId),
    index("presets_category_idx").on(t.categoryId),
    index("presets_overall_status_idx").on(t.overallStatus),
    index("presets_xml_status_idx").on(t.xmlStatus),
    index("presets_published_idx").on(t.publishedAt),
    index("presets_created_idx").on(t.createdAt),
    index("presets_next_retry_idx").on(t.nextRetryAt),
  ],
);

export const presetLinks = pgTable(
  "preset_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    presetId: uuid("preset_id")
      .notNull()
      .references(() => presets.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // xml | five_mb | unknown
    url: text("url").notNull(),
    sourceType: text("source_type").notNull(), // caption | comment | bimz_resolver | manual | related_search
    sourceRef: text("source_ref"),
    hostLabel: text("host_label"),
    confidence: integer("confidence").notNull().default(0),
    verified: boolean("verified").notNull().default(false),
    httpStatus: integer("http_status"),
    contentType: text("content_type"),
    contentLength: integer("content_length"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("preset_links_preset_url_uq").on(t.presetId, t.url),
    index("preset_links_kind_idx").on(t.kind),
  ],
);

/* ------------------------------------------------------------ scan system */

export const scanJobs = pgTable(
  "scan_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(), // keyword_search | url_ingest | preset_scan | retry_pending
    status: text("status").notNull().default("queued"), // queued|running|succeeded|failed|skipped
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    provider: text("provider"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    found: integer("found").notNull().default(0),
    scanned: integer("scanned").notNull().default(0),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scan_jobs_status_idx").on(t.status), index("scan_jobs_type_idx").on(t.type)],
);

export const scanAttempts = pgTable(
  "scan_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").references(() => scanJobs.id, { onDelete: "cascade" }),
    presetId: uuid("preset_id").references(() => presets.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(), // metadata|caption|comments|related_search|bimz_resolver|validation
    provider: text("provider"),
    ok: boolean("ok").notNull().default(false),
    statusCode: integer("status_code"),
    durationMs: integer("duration_ms"),
    message: text("message"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("scan_attempts_job_idx").on(t.jobId),
    index("scan_attempts_preset_idx").on(t.presetId),
    index("scan_attempts_created_idx").on(t.createdAt),
  ],
);

/* ----------------------------------------------------------- social layer */

export const globalChatMessages = pgTable(
  "global_chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientKey: text("client_key").notNull(), // whatsapp message id, or uuid for website msgs
    source: text("source").notNull().default("website"), // whatsapp | website | system
    authorName: text("author_name").notNull(),
    authorJid: text("author_jid"),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    avatarKey: text("avatar_key"),
    body: text("body").notNull(),
    isDeveloper: boolean("is_developer").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("global_chat_client_key_uq").on(t.clientKey),
    index("global_chat_created_idx").on(t.createdAt),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    username: text("username").notNull(),
    rating: integer("rating").notNull(),
    body: text("body").notNull(),
    notifyStatus: text("notify_status").notNull().default("queued"), // queued|sent|failed|skipped
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reviews_created_idx").on(t.createdAt)],
);

export const whatsappDeliveryLogs = pgTable(
  "whatsapp_delivery_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewId: uuid("review_id").references(() => reviews.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("whatsapp"),
    target: text("target").notNull(),
    kind: text("kind").notNull().default("review_image"), // review_image | system
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("queued"), // queued|pending|sent|failed
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    imageUrl: text("image_url"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("whatsapp_delivery_idem_uq").on(t.idempotencyKey),
    index("whatsapp_delivery_status_idx").on(t.status),
  ],
);

/* --------------------------------------------------------- bot heartbeat */

export const botRuntime = pgTable("bot_runtime", {
  id: text("id").primaryKey(), // "whatsapp"
  status: text("status").notNull().default("disconnected"), // disconnected|connecting|waiting_pairing|connected
  phone: text("phone"),
  pairingCode: text("pairing_code"),
  pairingExpiresAt: timestamp("pairing_expires_at", { withTimezone: true }),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // ---- panel-configured values (survive restarts, editable from /admin) ----
  configBotNumber: text("config_bot_number"),
  configTargetNumber: text("config_target_number"),
  configDisplayName: text("config_display_name"),
  configPlatform: text("config_platform").notNull().default("Ubuntu 22.04"),
  configBrowser: text("config_browser").notNull().default("Chrome"),
  configIntegration: text("config_integration").notNull().default("SPACEPRS"),
  configGlobalChatEnabled: boolean("config_global_chat_enabled").notNull().default(true),
  configReviewNotifyEnabled: boolean("config_review_notify_enabled").notNull().default(true),
  configUpdatedAt: timestamp("config_updated_at", { withTimezone: true }),
});

export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actor: text("actor").notNull().default("system"),
    action: text("action").notNull(),
    level: text("level").notNull().default("info"), // info|warn|error
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_created_idx").on(t.createdAt)],
);


/* ------------------------------------------------ social: TikTok-style account */
export const userFollows = pgTable(
  "user_follows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    followerId: uuid("follower_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    followingId: uuid("following_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_follows_uq").on(t.followerId, t.followingId),
    index("user_follows_following_idx").on(t.followingId),
  ],
);

export const presetFavorites = pgTable(
  "preset_favorites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    presetId: uuid("preset_id").notNull().references(() => presets.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("preset_favorites_uq").on(t.userId, t.presetId),
    index("preset_favorites_user_idx").on(t.userId),
  ],
);

export const presetViews = pgTable(
  "preset_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    presetId: uuid("preset_id").notNull().references(() => presets.id, { onDelete: "cascade" }),
    viewerId: uuid("viewer_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("preset_views_preset_idx").on(t.presetId)],
);

export const userUploads = pgTable(
  "user_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    presetId: uuid("preset_id").references(() => presets.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    caption: text("caption"),
    videoUrl: text("video_url").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    xmlUrl: text("xml_url"),
    fiveMbUrl: text("five_mb_url"),
    status: text("status").notNull().default("published"), // draft|published|removed
    viewCount: integer("view_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("user_uploads_user_idx").on(t.userId),
    index("user_uploads_created_idx").on(t.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type UserFollow = typeof userFollows.$inferSelect;
export type PresetFavorite = typeof presetFavorites.$inferSelect;
export type UserUpload = typeof userUploads.$inferSelect;
export type Preset = typeof presets.$inferSelect;
export type PresetLink = typeof presetLinks.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type ChatMessage = typeof globalChatMessages.$inferSelect;
export type ScanJob = typeof scanJobs.$inferSelect;


/* ------------------------------------------------- Premium Alight (AM) */

export const premiumActivations = pgTable(
  "premium_activations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email"),
    stage: text("stage").notNull().default("idle"), // idle|sent|verified|applied|failed
    idTokenRef: text("id_token_ref"), // short reference only, never the raw token
    plan: text("plan"),
    product: text("product"),
    lastMessage: text("last_message"),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("premium_user_uq").on(t.userId),
    index("premium_stage_idx").on(t.stage),
  ],
);

export type PremiumActivation = typeof premiumActivations.$inferSelect;


/* ------------------------------------------------ permanent video cache */

export const videoAssets = pgTable(
  "video_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    presetId: uuid("preset_id")
      .notNull()
      .references(() => presets.id, { onDelete: "cascade" }),
    tiktokId: text("tiktok_id").notNull(),
    /** Raw mp4 bytes — keeps the preset playable forever, even when the CDN link dies. */
    data: text("data").notNull(), // base64
    contentType: text("content_type").notNull().default("video/mp4"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    sourceUrl: text("source_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("video_assets_preset_uq").on(t.presetId), index("video_assets_tiktok_idx").on(t.tiktokId)],
);

/* ------------------------------------------------- support / complaints */

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
    category: text("category").notNull().default("kendala"), // kendala | saran | lainnya
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull().default("open"), // open | answered | closed
    notifyStatus: text("notify_status").notNull().default("queued"),
    unreadForUser: boolean("unread_for_user").notNull().default(false),
    lastReplyAt: timestamp("last_reply_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("support_user_idx").on(t.userId), index("support_status_idx").on(t.status)],
);

export const supportReplies = pgTable(
  "support_replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    author: text("author").notNull().default("developer"), // developer | user
    authorName: text("author_name").notNull().default("BimzOfficial ✓"),
    body: text("body").notNull(),
    viaWhatsappId: text("via_whatsapp_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("support_replies_ticket_idx").on(t.ticketId)],
);

export type VideoAsset = typeof videoAssets.$inferSelect;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type SupportReply = typeof supportReplies.$inferSelect;


/* ----------------------------------------------------- CapCut templates */

export const capcutTemplates = pgTable(
  "capcut_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tiktokId: text("tiktok_id").notNull(),
    videoUrl: text("video_url").notNull(),
    title: text("title"),
    caption: text("caption"),
    creator: text("creator"),
    creatorName: text("creator_name"),
    thumbnailUrl: text("thumbnail_url"),
    playableUrl: text("playable_url"),
    playableExpiresAt: timestamp("playable_expires_at", { withTimezone: true }),
    /** Canonical https://www.capcut.com/t/<slug> link. */
    templateUrl: text("template_url"),
    templateSlug: text("template_slug"),
    /** capcut://template/detail?template_id=... deep link when derivable. */
    deepLink: text("deep_link"),
    templateName: text("template_name"),
    clips: integer("clips"),
    durationSec: integer("duration_sec"),
    usageCount: integer("usage_count"),
    keyword: text("keyword"),
    status: text("status").notNull().default("NEW"), // NEW|SCANNING|LINK_FOUND|NO_LINK|FAILED
    linkSource: text("link_source"), // caption | comment | deep_scan
    confidence: integer("confidence").notNull().default(0),
    stats: jsonb("stats").$type<{
      plays?: number | null;
      likes?: number | null;
      comments?: number | null;
      shares?: number | null;
    }>(),
    lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }),
    scanAttempts: integer("scan_attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("capcut_tiktok_uq").on(t.tiktokId),
    index("capcut_status_idx").on(t.status),
    index("capcut_keyword_idx").on(t.keyword),
    index("capcut_created_idx").on(t.createdAt),
  ],
);

export type CapcutTemplate = typeof capcutTemplates.$inferSelect;
