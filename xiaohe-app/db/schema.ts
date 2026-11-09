import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, index, uniqueIndex, check } from "drizzle-orm/sqlite-core";

// Private pilot: ownership and roles are derived from authenticated identity.
export const workspaces = sqliteTable("workspaces", {
  userId: text("user_id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  state: text("state").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const uploadedFiles = sqliteTable("uploaded_files", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  objectKey: text("object_key").notNull().unique(),
  filename: text("filename").notNull(),
  mediaType: text("media_type").notNull(),
  size: integer("size").notNull(),
  purpose: text("purpose").notNull(),
  // Inserted only after R2 PUT finishes. Older unregistered uploads cannot
  // complete registration across a committed history deletion.
  historyEpoch: integer("history_epoch").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (table) => [index("uploaded_files_owner").on(table.userId)]);

export const workspaceMemberships = sqliteTable("workspace_memberships", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.userId),
  userId: text("user_id").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  revokedAt: text("revoked_at"),
}, table => [
  uniqueIndex("membership_workspace_user").on(table.workspaceId, table.userId),
  uniqueIndex("membership_active_email").on(table.workspaceId, table.email).where(sql`${table.status} = 'active'`),
  uniqueIndex("membership_one_active_student").on(table.workspaceId).where(sql`${table.status} = 'active' AND ${table.role} = 'student'`),
  index("membership_user_status").on(table.userId, table.status),
  check("membership_nonowner_role", sql`${table.role} IN ('student', 'parent', 'teacher', 'editor', 'reviewer')`),
  check("membership_status", sql`${table.status} IN ('active', 'revoked')`),
  check("membership_not_owner", sql`${table.workspaceId} <> ${table.userId}`),
]);

export const workspaceInvites = sqliteTable("workspace_invites", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.userId),
  tokenHash: text("token_hash").notNull().unique(),
  role: text("role").notNull(),
  email: text("email").notNull(),
  label: text("label").notNull().default(""),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  acceptedAt: text("accepted_at"),
  acceptedBy: text("accepted_by"),
  acceptanceId: text("acceptance_id"),
  revokedAt: text("revoked_at"),
}, table => [
  index("invite_workspace_status").on(table.workspaceId, table.status),
  check("invite_nonowner_role", sql`${table.role} IN ('student', 'parent', 'teacher', 'editor', 'reviewer')`),
  check("invite_status", sql`${table.status} IN ('pending', 'accepted', 'revoked')`),
]);
