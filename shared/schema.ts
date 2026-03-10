import { z } from "zod";
import { pgTable, serial, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).notNull().default("user"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const whatsappStatusSchema = z.enum([
  "disconnected",
  "qr_code",
  "connecting",
  "connected",
  "auth_failure",
]);

export type WhatsAppStatus = z.infer<typeof whatsappStatusSchema>;

export interface WhatsAppGroup {
  id: string;
  name: string;
  participantCount: number;
  isAdmin: boolean;
}

export interface GroupParticipant {
  id: string;
  number: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isLid?: boolean;
  resolvedPhone?: string;
}

export interface WhatsAppContact {
  id: string;
  name: string;
  number: string;
  isLid?: boolean;
}

export type TransferMode = "direct" | "invite";

export interface TransferRequest {
  sourceGroupId: string;
  targetGroupId: string;
  participantIds: string[];
  mode: TransferMode;
}

export interface TransferResult {
  participantId: string;
  success: boolean;
  error?: string;
  sessionId?: string;
}

export interface TransferProgress {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  results: TransferResult[];
  status: "in_progress" | "completed" | "error" | "cooldown" | "paused" | "stopped";
  cooldownSeconds?: number;
}

export interface SessionInfo {
  id: string;
  status: WhatsAppStatus;
  phoneNumber?: string;
  addsThisHour: number;
  maxAddsPerHour: number;
  cooldownUntil?: number;
  isBusy: boolean;
  totalAdds: number;
  totalInvites: number;
}

export interface QueueStatus {
  totalMembers: number;
  processed: number;
  succeeded: number;
  failed: number;
  remaining: number;
  isRunning: boolean;
  isPaused: boolean;
  activeSessionId?: string;
  globalAddsCount: number;
  safetyPauseAt: number;
}

export interface WSMessage {
  type:
    | "status"
    | "qr_code"
    | "groups"
    | "participants"
    | "transfer_progress"
    | "sessions_update"
    | "queue_update"
    | "error";
  data: any;
}
