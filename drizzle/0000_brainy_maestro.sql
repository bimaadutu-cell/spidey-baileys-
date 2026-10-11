CREATE SCHEMA "spaceprs";
--> statement-breakpoint
CREATE TABLE "spaceprs"."activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text DEFAULT 'system' NOT NULL,
	"action" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaceprs"."bot_runtime" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"phone" text,
	"pairing_code" text,
	"pairing_expires_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"config_bot_number" text,
	"config_target_number" text,
	"config_display_name" text,
	"config_platform" text DEFAULT 'Ubuntu 22.04' NOT NULL,
	"config_browser" text DEFAULT 'Chrome' NOT NULL,
	"config_integration" text DEFAULT 'SPACEPRS' NOT NULL,
	"config_global_chat_enabled" boolean DEFAULT true NOT NULL,
	"config_review_notify_enabled" boolean DEFAULT true NOT NULL,
	"config_updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "spaceprs"."capcut_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tiktok_id" text NOT NULL,
	"video_url" text NOT NULL,
	"title" text,
	"caption" text,
	"creator" text,
	"creator_name" text,
	"thumbnail_url" text,
	"playable_url" text,
	"playable_expires_at" timestamp with time zone,
	"template_url" text,
	"template_slug" text,
	"deep_link" text,
	"template_name" text,
	"clips" integer,
	"duration_sec" integer,
	"usage_count" integer,
	"keyword" text,
	"status" text DEFAULT 'NEW' NOT NULL,
	"link_source" text,
	"confidence" integer DEFAULT 0 NOT NULL,
	"stats" jsonb,
	"last_scanned_at" timestamp with time zone,
	"scan_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaceprs"."creators" (
	"id" serial PRIMARY KEY NOT NULL,
	"unique_id" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"profile_url" text,
	"verified" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaceprs"."global_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_key" text NOT NULL,
	"source" text DEFAULT 'website' NOT NULL,
	"author_name" text NOT NULL,
	"author_jid" text,
	"author_user_id" uuid,
	"avatar_key" text,
	"body" text NOT NULL,
	"is_developer" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaceprs"."premium_activations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text,
	"stage" text DEFAULT 'idle' NOT NULL,
	"id_token_ref" text,
	"plan" text,
	"product" text,
	"last_message" text,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaceprs"."preset_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"label_cn" text,
	"description" text,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaceprs"."preset_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text,
	"host_label" text,
	"confidence" integer DEFAULT 0 NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"http_status" integer,
	"content_type" text,
	"content_length" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaceprs"."presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tiktok_id" text NOT NULL,
	"video_url" text NOT NULL,
	"embed_url" text,
	"thumbnail_url" text,
	"playable_url" text,
	"playable_source" text,
	"playable_expires_at" timestamp with time zone,
	"title" text,
	"caption" text,
	"hashtags" text[] DEFAULT '{}' NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"creator_id" integer,
	"sound_id" integer,
	"category_id" integer,
	"duration_sec" integer,
	"stats" jsonb,
	"published_at" timestamp with time zone,
	"xml_status" text DEFAULT 'PENDING' NOT NULL,
	"five_mb_status" text DEFAULT 'PENDING' NOT NULL,
	"overall_status" text DEFAULT 'NEW' NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"xml_url" text,
	"five_mb_url" text,
	"xml_source" text,
	"five_mb_source" text,
	"last_scanned_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"scan_attempts" integer DEFAULT 0 NOT NULL,
	"scan_error" text,
	"discovery_source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaceprs"."reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"username" text NOT NULL,
	"rating" integer NOT NULL,
	"body" text NOT NULL,
	"notify_status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaceprs"."scan_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"preset_id" uuid,
	"stage" text NOT NULL,
	"provider" text,
	"ok" boolean DEFAULT false NOT NULL,
	"status_code" integer,
	"duration_ms" integer,
	"message" text,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaceprs"."scan_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"found" integer DEFAULT 0 NOT NULL,
	"scanned" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaceprs"."sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"user_agent" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaceprs"."sounds" (
	"id" serial PRIMARY KEY NOT NULL,
	"tiktok_id" text,
	"title" text,
	"author_name" text,
	"url" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaceprs"."support_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author" text DEFAULT 'developer' NOT NULL,
	"author_name" text DEFAULT 'BimzOfficial ✓' NOT NULL,
	"body" text NOT NULL,
	"via_whatsapp_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaceprs"."support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"username" text NOT NULL,
	"category" text DEFAULT 'kendala' NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"notify_status" text DEFAULT 'queued' NOT NULL,
	"unread_for_user" boolean DEFAULT false NOT NULL,
	"last_reply_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaceprs"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_key" text DEFAULT 'neon-01' NOT NULL,
	"avatar_url" text,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "spaceprs"."video_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preset_id" uuid NOT NULL,
	"tiktok_id" text NOT NULL,
	"data" text NOT NULL,
	"content_type" text DEFAULT 'video/mp4' NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaceprs"."whatsapp_delivery_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"target" text NOT NULL,
	"kind" text DEFAULT 'review_image' NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"image_url" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spaceprs"."global_chat_messages" ADD CONSTRAINT "global_chat_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "spaceprs"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaceprs"."premium_activations" ADD CONSTRAINT "premium_activations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "spaceprs"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaceprs"."preset_links" ADD CONSTRAINT "preset_links_preset_id_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "spaceprs"."presets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaceprs"."presets" ADD CONSTRAINT "presets_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "spaceprs"."creators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaceprs"."presets" ADD CONSTRAINT "presets_sound_id_sounds_id_fk" FOREIGN KEY ("sound_id") REFERENCES "spaceprs"."sounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaceprs"."presets" ADD CONSTRAINT "presets_category_id_preset_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "spaceprs"."preset_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaceprs"."reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "spaceprs"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaceprs"."scan_attempts" ADD CONSTRAINT "scan_attempts_job_id_scan_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "spaceprs"."scan_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaceprs"."scan_attempts" ADD CONSTRAINT "scan_attempts_preset_id_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "spaceprs"."presets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaceprs"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "spaceprs"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaceprs"."support_replies" ADD CONSTRAINT "support_replies_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "spaceprs"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaceprs"."support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "spaceprs"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaceprs"."video_assets" ADD CONSTRAINT "video_assets_preset_id_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "spaceprs"."presets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaceprs"."whatsapp_delivery_logs" ADD CONSTRAINT "whatsapp_delivery_logs_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "spaceprs"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_created_idx" ON "spaceprs"."activity_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "capcut_tiktok_uq" ON "spaceprs"."capcut_templates" USING btree ("tiktok_id");--> statement-breakpoint
CREATE INDEX "capcut_status_idx" ON "spaceprs"."capcut_templates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "capcut_keyword_idx" ON "spaceprs"."capcut_templates" USING btree ("keyword");--> statement-breakpoint
CREATE INDEX "capcut_created_idx" ON "spaceprs"."capcut_templates" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "creators_unique_id_uq" ON "spaceprs"."creators" USING btree ("unique_id");--> statement-breakpoint
CREATE UNIQUE INDEX "global_chat_client_key_uq" ON "spaceprs"."global_chat_messages" USING btree ("client_key");--> statement-breakpoint
CREATE INDEX "global_chat_created_idx" ON "spaceprs"."global_chat_messages" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "premium_user_uq" ON "spaceprs"."premium_activations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "premium_stage_idx" ON "spaceprs"."premium_activations" USING btree ("stage");--> statement-breakpoint
CREATE UNIQUE INDEX "preset_categories_slug_uq" ON "spaceprs"."preset_categories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "preset_links_preset_url_uq" ON "spaceprs"."preset_links" USING btree ("preset_id","url");--> statement-breakpoint
CREATE INDEX "preset_links_kind_idx" ON "spaceprs"."preset_links" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "presets_tiktok_id_uq" ON "spaceprs"."presets" USING btree ("tiktok_id");--> statement-breakpoint
CREATE INDEX "presets_creator_idx" ON "spaceprs"."presets" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "presets_category_idx" ON "spaceprs"."presets" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "presets_overall_status_idx" ON "spaceprs"."presets" USING btree ("overall_status");--> statement-breakpoint
CREATE INDEX "presets_xml_status_idx" ON "spaceprs"."presets" USING btree ("xml_status");--> statement-breakpoint
CREATE INDEX "presets_published_idx" ON "spaceprs"."presets" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "presets_created_idx" ON "spaceprs"."presets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "presets_next_retry_idx" ON "spaceprs"."presets" USING btree ("next_retry_at");--> statement-breakpoint
CREATE INDEX "reviews_created_idx" ON "spaceprs"."reviews" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "scan_attempts_job_idx" ON "spaceprs"."scan_attempts" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "scan_attempts_preset_idx" ON "spaceprs"."scan_attempts" USING btree ("preset_id");--> statement-breakpoint
CREATE INDEX "scan_attempts_created_idx" ON "spaceprs"."scan_attempts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "scan_jobs_status_idx" ON "spaceprs"."scan_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scan_jobs_type_idx" ON "spaceprs"."scan_jobs" USING btree ("type");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "spaceprs"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "spaceprs"."sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sounds_url_uq" ON "spaceprs"."sounds" USING btree ("url");--> statement-breakpoint
CREATE INDEX "sounds_title_idx" ON "spaceprs"."sounds" USING btree ("title");--> statement-breakpoint
CREATE INDEX "support_replies_ticket_idx" ON "spaceprs"."support_replies" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "support_user_idx" ON "spaceprs"."support_tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "support_status_idx" ON "spaceprs"."support_tickets" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uq" ON "spaceprs"."users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "spaceprs"."users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "video_assets_preset_uq" ON "spaceprs"."video_assets" USING btree ("preset_id");--> statement-breakpoint
CREATE INDEX "video_assets_tiktok_idx" ON "spaceprs"."video_assets" USING btree ("tiktok_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_delivery_idem_uq" ON "spaceprs"."whatsapp_delivery_logs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "whatsapp_delivery_status_idx" ON "spaceprs"."whatsapp_delivery_logs" USING btree ("status");