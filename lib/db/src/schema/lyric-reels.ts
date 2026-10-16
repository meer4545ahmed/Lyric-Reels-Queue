import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const videosTable = pgTable("lyric_reels_videos", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  originalFilename: text("original_filename").notNull(),
  objectPath: text("object_path").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  lastPostedAt: timestamp("last_posted_at", { withTimezone: true }),
  postedCount: integer("posted_count").notNull().default(0),
});

export const lyricReelsOwnerTable = pgTable("lyric_reels_owner", {
  id: integer("id").primaryKey().default(1),
  ownerId: text("owner_id").notNull(),
});

export const scheduleSettingsTable = pgTable(
  "lyric_reels_schedule_settings",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    intervalHours: integer("interval_hours").notNull().default(3),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    nextPostAt: timestamp("next_post_at", { withTimezone: true }),
    lastPostedAt: timestamp("last_posted_at", { withTimezone: true }),
    nextVideoId: integer("next_video_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("lyric_reels_schedule_owner_unique").on(table.ownerId)],
);
