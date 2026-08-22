/**
 * This module's tables. drizzle-kit reads every `src/features/<module>/schema.ts` (see
 * drizzle.config.ts) and generates the migrations in `drizzle/` from the diff.
 *
 * This file is the single source of truth for the shape: change it, run `bun run db:generate`,
 * review the SQL it wrote, and commit both.
 */
import { index, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { StoredDocument } from "../../platform/stored-document";
import type { StageName, StageStatus } from "./stage";

export const resumeSessions = pgTable(
  "resume_sessions",
  {
    id: text("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    company: text("company").notNull(),
    role: text("role").notNull(),
    // $type is what buys the type safety: reads come back as StoredDocument, not `unknown`.
    resume: jsonb("resume").$type<StoredDocument>().notNull(),
    jobDescription: jsonb("job_description").$type<StoredDocument>().notNull(),
  },
  (table) => [index("resume_sessions_updated_at_idx").on(table.updatedAt.desc())],
);

export const resumeStages = pgTable(
  "resume_stages",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => resumeSessions.id, { onDelete: "cascade" }),
    stage: text("stage").$type<StageName>().notNull(),
    status: text("status").$type<StageStatus>().notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    result: jsonb("result").$type<Record<string, unknown>>(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.stage] })],
);
