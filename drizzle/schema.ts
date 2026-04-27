/**
 * Dobro Support — Drizzle schema v1
 * PRD: docs/prd/dobro-support.md
 *
 * Status machine (submissions):
 *   pending_auth -> queued -> processing -> draft -> (approved | rejected) -> delivered | failed
 *
 * Security strategy:
 *   - RLS enabled on all student-facing tables (submissions, corrections, screenshots, pdfs, monitor_actions-read)
 *   - Session context set per-request via SET LOCAL app.user_email / app.user_role
 *   - Service role (owner) bypasses for cron jobs, migrations, seed
 *   - See migrations/0002_rls.sql for policy definitions
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  jsonb,
  numeric,
  integer,
  inet,
  uniqueIndex,
  index,
  check,
  customType,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ---------- Custom types ----------
const bytea = customType<{ data: Buffer; driverData: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

// ---------- Enums ----------
export const submissionStatus = pgEnum('submission_status', [
  'pending_auth',
  'queued',
  'processing',
  'draft',
  'approved',
  'rejected',
  'delivered',
  'failed',
]);

export const monitorActionType = pgEnum('monitor_action_type', [
  'edit',
  'approve',
  'reject',
  'regenerate',
]);

export const authEventType = pgEnum('auth_event_type', [
  'magic_link_issued',
  'magic_link_consumed',
  'magic_link_expired',
  'magic_link_rate_limited',
  'login',
  'logout',
  'session_refresh',
  'unauthorized_access_attempt',
]);

export const viewport = pgEnum('viewport', ['desktop', 'mobile']);

// ---------- auth_tokens ----------
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenHashIdx: uniqueIndex('auth_tokens_token_hash_idx').on(t.tokenHash),
    emailCreatedIdx: index('auth_tokens_email_created_idx').on(t.email, t.createdAt.desc()),
  })
);

// ---------- auth_events (audit) ----------
export const authEvents = pgTable(
  'auth_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: authEventType('event_type').notNull(),
    emailHash: text('email_hash').notNull(), // sha256(lower(email))
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailHashCreatedIdx: index('auth_events_email_hash_created_idx').on(
      t.emailHash,
      t.createdAt.desc()
    ),
    createdIdx: index('auth_events_created_idx').on(t.createdAt.desc()),
  })
);

// ---------- submissions ----------
export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentEmail: text('student_email').notNull(),
    githubUrl: text('github_url').notNull(),
    deployedUrl: text('deployed_url'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    correctedAt: timestamp('corrected_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    status: submissionStatus('status').notNull().default('pending_auth'),
    errorMsg: text('error_msg'),
    correctionUrl: text('correction_url'),
    // course_version: '1.0' (legado) ou '2.0' (atual). Aluno não vê na UI,
    // só monitor enxerga no dashboard. Em v1.2 será derivado de challenge_id
    // quando a tabela challenges for criada.
    courseVersion: text('course_version').notNull().default('2.0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailSubmittedIdx: index('submissions_email_submitted_idx').on(
      t.studentEmail,
      t.submittedAt.desc()
    ),
    statusSubmittedIdx: index('submissions_status_submitted_idx').on(t.status, t.submittedAt),
    courseVersionIdx: index('submissions_course_version_idx').on(t.courseVersion),
    // Partial index: cron pickup + overdue queries only look at non-terminal statuses
    activeStatusIdx: index('submissions_active_status_idx')
      .on(t.status, t.submittedAt)
      .where(sql`status IN ('queued','processing','draft','approved')`),
    deliveredAtIdx: index('submissions_delivered_at_idx')
      .on(t.deliveredAt)
      .where(sql`delivered_at IS NOT NULL`),
    ghUrlChk: check(
      'submissions_github_url_chk',
      sql`github_url ~ '^https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/?$'`
    ),
    emailChk: check(
      'submissions_email_chk',
      sql`student_email ~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'`
    ),
    courseVersionChk: check(
      'submissions_course_version_chk',
      sql`course_version IN ('1.0', '2.0')`
    ),
  })
);

// ---------- screenshots ----------
export const screenshots = pgTable(
  'screenshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    viewport: viewport('viewport').notNull(),
    data: bytea('data').notNull(),
    mimeType: text('mime_type').notNull().default('image/webp'),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    submissionViewportIdx: uniqueIndex('screenshots_submission_viewport_idx').on(
      t.submissionId,
      t.viewport
    ),
    sizeChk: check('screenshots_size_chk', sql`size_bytes <= 524288`), // 512KB hard cap
  })
);

// ---------- corrections ----------
export const corrections = pgTable(
  'corrections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id')
      .notNull()
      .unique()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    grade: numeric('grade', { precision: 3, scale: 1 }).notNull(),
    strengths: jsonb('strengths').$type<string[]>().notNull(),
    improvements: jsonb('improvements')
      .$type<
        {
          area: string;
          severity: 'low' | 'medium' | 'high';
          suggestion: string;
          file?: string;
          lineStart?: number;
          lineEnd?: number;
          codeSnippet?: string;
          proposedFix?: string;
        }[]
      >()
      .notNull(),
    narrativeMd: text('narrative_md').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    // Tracking de custo agregado (gerador + polisher somados). Permite
    // monitorar custo médio por correção e detectar regressão de billing.
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
    ragSources: jsonb('rag_sources').$type<string[]>(), // v2 — null in v1
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    gradeChk: check('corrections_grade_chk', sql`grade >= 0 AND grade <= 10`),
    tokensInChk: check('corrections_tokens_in_nonneg_chk', sql`tokens_in >= 0`),
    tokensOutChk: check('corrections_tokens_out_nonneg_chk', sql`tokens_out >= 0`),
    costUsdChk: check('corrections_cost_usd_nonneg_chk', sql`cost_usd >= 0`),
    createdCostIdx: index('corrections_created_cost_idx').on(t.createdAt, t.costUsd),
  })
);

// ---------- monitor_actions (audit, immutable) ----------
export const monitorActions = pgTable(
  'monitor_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    monitorUserId: text('monitor_user_id').notNull(), // Neon Auth user id
    monitorEmail: text('monitor_email').notNull(),
    action: monitorActionType('action').notNull(),
    edits: jsonb('edits'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    submissionCreatedIdx: index('monitor_actions_submission_created_idx').on(
      t.submissionId,
      t.createdAt.desc()
    ),
  })
);

// ---------- pdfs ----------
export const pdfs = pgTable(
  'pdfs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    data: bytea('data').notNull(),
    mimeType: text('mime_type').notNull().default('application/pdf'),
    version: integer('version').notNull().default(1),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    submissionVersionIdx: uniqueIndex('pdfs_submission_version_idx').on(
      t.submissionId,
      t.version
    ),
    sizeChk: check('pdfs_size_chk', sql`size_bytes <= 2097152`), // 2MB hard cap
  })
);

// ---------- Relations ----------
export const submissionsRelations = relations(submissions, ({ many, one }) => ({
  screenshots: many(screenshots),
  correction: one(corrections, {
    fields: [submissions.id],
    references: [corrections.submissionId],
  }),
  monitorActions: many(monitorActions),
  pdfs: many(pdfs),
}));

export const screenshotsRelations = relations(screenshots, ({ one }) => ({
  submission: one(submissions, {
    fields: [screenshots.submissionId],
    references: [submissions.id],
  }),
}));

export const correctionsRelations = relations(corrections, ({ one }) => ({
  submission: one(submissions, {
    fields: [corrections.submissionId],
    references: [submissions.id],
  }),
}));

export const monitorActionsRelations = relations(monitorActions, ({ one }) => ({
  submission: one(submissions, {
    fields: [monitorActions.submissionId],
    references: [submissions.id],
  }),
}));

export const pdfsRelations = relations(pdfs, ({ one }) => ({
  submission: one(submissions, {
    fields: [pdfs.submissionId],
    references: [submissions.id],
  }),
}));

// ---------- Type exports ----------
export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type Correction = typeof corrections.$inferSelect;
export type NewCorrection = typeof corrections.$inferInsert;
export type Screenshot = typeof screenshots.$inferSelect;
export type NewScreenshot = typeof screenshots.$inferInsert;
export type MonitorAction = typeof monitorActions.$inferSelect;
export type NewMonitorAction = typeof monitorActions.$inferInsert;
export type Pdf = typeof pdfs.$inferSelect;
export type NewPdf = typeof pdfs.$inferInsert;
export type AuthToken = typeof authTokens.$inferSelect;
export type NewAuthToken = typeof authTokens.$inferInsert;
export type AuthEvent = typeof authEvents.$inferSelect;
export type NewAuthEvent = typeof authEvents.$inferInsert;
