import { pgTable, uuid, text, boolean, bigint, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  role: text("role", { enum: ["owner", "member"] })
    .notNull()
    .default("member"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const libraries = pgTable("libraries", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const files = pgTable("files", {
  id: uuid("id").defaultRandom().primaryKey(),
  libraryId: uuid("library_id")
    .notNull()
    .references(() => libraries.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  size: bigint("size", { mode: "number" }).notNull().default(0),
  originalCreatedAt: timestamp("original_created_at", { withTimezone: true }),
  trashedAt: timestamp("trashed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    libraryId: uuid("library_id")
      .notNull()
      .references(() => libraries.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("tags_library_name_idx").on(table.libraryId, table.name),
    uniqueIndex("tags_library_color_idx").on(table.libraryId, table.color),
  ],
);

export const fileTags = pgTable(
  "file_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("file_tags_file_tag_idx").on(table.fileId, table.tagId)],
);

export const libraryMembers = pgTable(
  "library_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    libraryId: uuid("library_id")
      .notNull()
      .references(() => libraries.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["admin", "viewer"] })
      .notNull()
      .default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("library_members_library_user_idx").on(table.libraryId, table.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("accounts_provider_account_idx").on(table.provider, table.providerAccountId),
  ],
);

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sessionToken: text("session_token").notNull().unique(),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
