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
  boolean,
  uniqueIndex,
  index,
  check,
  customType,
  vector,
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
  'two_factor_enabled',
  'two_factor_disabled',
  'two_factor_failed',
]);

export const viewport = pgEnum('viewport', ['desktop', 'mobile']);

export const kbSourceType = pgEnum('kb_source_type', ['pdf', 'markdown', 'faq']);
export const kbDocumentStatus = pgEnum('kb_document_status', ['processing', 'active', 'failed', 'archived']);

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
    // IP do cliente que enviou. Usado pra rate limit em /api/correcoes/submit.
    // Nullable porque rows antigas (pré-0005) não têm o dado.
    clientIp: inet('client_ip'),
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
    clientIpRecentIdx: index('submissions_client_ip_recent_idx').on(
      t.clientIp,
      t.submittedAt.desc()
    ),
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

// ---------- monitor_users ----------
// Substitui MONITOR_EMAILS + MONITOR_PASSWORD do env. Cada monitor tem
// credencial própria com hash scrypt em password_hash. RLS service-only.
// Bootstrap via scripts/add-monitor.ts.
export const monitorUsers = pgTable('monitor_users', {
  email: text('email').primaryKey(),
  passwordHash: text('password_hash').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  // 2FA (TOTP). totpSecret é cifrado (lib/crypto-secret). Enquanto
  // totpEnabledAt é NULL o secret é só um enrollment pendente e o 2FA não é
  // exigido no login; após a confirmação do primeiro código vira obrigatório.
  totpSecret: text('totp_secret'),
  totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
  totpBackupCodes: jsonb('totp_backup_codes').$type<string[]>(),
});

// ---------- sales_users ----------
// Vendedores do time comercial. Bootstrap via scripts/add-sales-user.ts.
export const salesUsers = pgTable('sales_users', {
  email: text('email').primaryKey(),
  passwordHash: text('password_hash').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
});

// ---------- sales_audit_events ----------
export const salesAuditEventType = pgEnum('sales_audit_event_type', [
  'login',
  'logout',
  'unauthorized_access_attempt',
  'kb_create',
  'kb_reupload',
  'kb_archive',
  'kb_reactivate',
  'kb_reindex',
  'chat_query',
  'chat_response',
  'rate_limited',
  'chat_context_update',
  'how_it_works_update',
  'chat_context_rejected',
  'chat_context_restore',
  'chat_context_submitted',
  'chat_context_approved',
  'chat_context_review_rejected',
]);

export const salesActorRole = pgEnum('sales_actor_role', ['sales', 'monitor', 'service']);

export const salesAuditEvents = pgTable(
  'sales_audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: salesAuditEventType('event_type').notNull(),
    actorEmail: text('actor_email'),
    actorRole: salesActorRole('actor_role').notNull(),
    targetId: uuid('target_id'),
    metadata: jsonb('metadata'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actorCreatedIdx: index('sales_audit_events_actor_created_idx').on(t.actorEmail, t.createdAt.desc()),
    eventTypeCreatedIdx: index('sales_audit_events_event_type_created_idx').on(t.eventType, t.createdAt.desc()),
  })
);

// ---------- kb_documents ----------
export const kbDocuments = pgTable(
  'kb_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    sourceType: kbSourceType('source_type').notNull(),
    description: text('description'),
    tags: text('tags').array().notNull().default(sql`'{}'`),
    status: kbDocumentStatus('status').notNull().default('processing'),
    currentVersionId: uuid('current_version_id'),
    createdByEmail: text('created_by_email').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusUpdatedIdx: index('kb_documents_status_updated_idx').on(t.status, t.updatedAt.desc()),
    sourceTypeIdx: index('kb_documents_source_type_idx').on(t.sourceType),
  })
);

// ---------- kb_document_versions ----------
export const kbDocumentVersions = pgTable(
  'kb_document_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id').notNull().references(() => kbDocuments.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    rawText: text('raw_text').notNull(),
    rawBytes: bytea('raw_bytes'),
    charCount: integer('char_count').notNull(),
    embeddingTokens: integer('embedding_tokens').notNull().default(0),
    embeddingCostUsd: numeric('embedding_cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
    createdByEmail: text('created_by_email').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    docVersionUniq: uniqueIndex('kb_document_versions_doc_version_idx').on(t.documentId, t.version),
  })
);

// ---------- kb_chunks ----------
export const kbChunks = pgTable(
  'kb_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id').notNull().references(() => kbDocuments.id),
    versionId: uuid('version_id').notNull().references(() => kbDocumentVersions.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    versionChunkUniq: uniqueIndex('kb_chunks_version_chunk_idx').on(t.versionId, t.chunkIndex),
    documentIdx: index('kb_chunks_document_idx').on(t.documentId),
  })
);

// ---------- sales_conversations ----------
export const salesConversations = pgTable(
  'sales_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    salesUserEmail: text('sales_user_email').notNull(),
    title: text('title'),
    messageCount: integer('message_count').notNull().default(0),
    totalCostUsd: numeric('total_cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userUpdatedIdx: index('sales_conversations_user_updated_idx').on(
      t.salesUserEmail,
      t.updatedAt.desc()
    ),
  })
);

// ---------- sales_messages ----------
export const salesMessageRole = pgEnum('sales_message_role', ['user', 'assistant', 'system']);

export const salesMessages = pgTable(
  'sales_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => salesConversations.id, { onDelete: 'cascade' }),
    role: salesMessageRole('role').notNull(),
    content: text('content').notNull(),
    sources: jsonb('sources').$type<
      { documentId: string; title: string; versionId: string; chunkId: string; score: number }[]
    >(),
    model: text('model'),
    promptVersion: text('prompt_version'),
    // Prompt de sistema efetivo no momento da resposta (regras + contexto do
    // gestor + trechos da KB). Permite depuração forense de respostas geradas
    // por chunks desatualizados ou prompt injection. Só preenchido em mensagens
    // do assistente.
    effectivePrompt: text('effective_prompt'),
    // Opções do Modo Quebra de Objeção, salvas estruturadas pra reconstruir os
    // cards copiáveis ao reabrir a conversa. NULL em mensagens normais.
    objectionOptions: jsonb('objection_options').$type<string[]>(),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    conversationCreatedIdx: index('sales_messages_conversation_created_idx').on(
      t.conversationId,
      t.createdAt
    ),
  })
);

// ---------- sales_settings ----------
// Key-value editável pelo gestor de vendas (role 'monitor'). Chaves:
//   chat_context — texto livre concatenado ao SYSTEM_PROMPT do agente
//   how_it_works — markdown lido pelos vendedores em /vendas/como-funciona
// RLS: service/monitor full; sales SELECT (em 0011_sales_settings.sql).
export const salesSettings = pgTable('sales_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull().default(''),
  updatedByEmail: text('updated_by_email'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Aprovação two-eyes (opt-in via SALES_CONTEXT_REQUIRE_APPROVAL). Quando
  // ligado, a edição fica aqui como pendente até um SEGUNDO monitor aprovar;
  // só então vira `value`. NULL = nada aguardando revisão.
  pendingValue: text('pending_value'),
  pendingByEmail: text('pending_by_email'),
  pendingAt: timestamp('pending_at', { withTimezone: true }),
});

export type SalesSettingKey = 'chat_context' | 'how_it_works';

// ---------- sales_settings_history ----------
// Snapshot imutável de cada versão salva de uma chave de sales_settings.
// Permite rollback rápido (≤1 min) caso uma versão maliciosa do chat_context
// entre em produção — sem precisar reescrever do zero ou mexer no DB.
// Insert-only: nunca atualizamos/apagamos linhas aqui (é o registro forense).
export const salesSettingsHistory = pgTable(
  'sales_settings_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    version: integer('version').notNull(),
    value: text('value').notNull(),
    editedByEmail: text('edited_by_email'),
    editedAt: timestamp('edited_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyVersionUniq: uniqueIndex('sales_settings_history_key_version_idx').on(t.key, t.version),
    keyEditedIdx: index('sales_settings_history_key_edited_idx').on(t.key, t.editedAt.desc()),
  })
);

// ---------- sales_eval_baseline ----------
// Respostas-baseline do agente pras perguntas canônicas (lib/sales-eval). Cada
// linha guarda a resposta e o embedding gerados num momento "confiável". Toda
// avaliação posterior compara as respostas atuais com este baseline pra
// detectar mudança de comportamento (ex.: chat_context envenenado).
export const salesEvalBaseline = pgTable('sales_eval_baseline', {
  questionId: text('question_id').primaryKey(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- sales_eval_runs ----------
// Histórico de execuções da avaliação. avgDivergence/maxDivergence em [0,1]
// (0 = idêntico ao baseline). flagged=true quando passou do threshold.
export const salesEvalRuns = pgTable(
  'sales_eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trigger: text('trigger').notNull(), // 'manual' | 'context_change' | 'baseline'
    chatContextHash: text('chat_context_hash'),
    questionCount: integer('question_count').notNull().default(0),
    avgDivergence: numeric('avg_divergence', { precision: 6, scale: 4 }),
    maxDivergence: numeric('max_divergence', { precision: 6, scale: 4 }),
    flagged: boolean('flagged').notNull().default(false),
    isBaseline: boolean('is_baseline').notNull().default(false),
    details: jsonb('details').$type<{ questionId: string; divergence: number }[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index('sales_eval_runs_created_idx').on(t.createdAt.desc()),
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

export const kbDocumentsRelations = relations(kbDocuments, ({ many }) => ({
  versions: many(kbDocumentVersions),
  chunks: many(kbChunks),
}));

export const kbDocumentVersionsRelations = relations(kbDocumentVersions, ({ one, many }) => ({
  document: one(kbDocuments, {
    fields: [kbDocumentVersions.documentId],
    references: [kbDocuments.id],
  }),
  chunks: many(kbChunks),
}));

export const kbChunksRelations = relations(kbChunks, ({ one }) => ({
  document: one(kbDocuments, {
    fields: [kbChunks.documentId],
    references: [kbDocuments.id],
  }),
  version: one(kbDocumentVersions, {
    fields: [kbChunks.versionId],
    references: [kbDocumentVersions.id],
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
export type MonitorUser = typeof monitorUsers.$inferSelect;
export type NewMonitorUser = typeof monitorUsers.$inferInsert;
export type KbDocument = typeof kbDocuments.$inferSelect;
export type NewKbDocument = typeof kbDocuments.$inferInsert;
export type KbDocumentVersion = typeof kbDocumentVersions.$inferSelect;
export type NewKbDocumentVersion = typeof kbDocumentVersions.$inferInsert;
export type KbChunk = typeof kbChunks.$inferSelect;
export type NewKbChunk = typeof kbChunks.$inferInsert;
export type SalesUser = typeof salesUsers.$inferSelect;
export type NewSalesUser = typeof salesUsers.$inferInsert;
export type SalesAuditEvent = typeof salesAuditEvents.$inferSelect;
export type NewSalesAuditEvent = typeof salesAuditEvents.$inferInsert;
export type SalesConversation = typeof salesConversations.$inferSelect;
export type NewSalesConversation = typeof salesConversations.$inferInsert;
export type SalesMessage = typeof salesMessages.$inferSelect;
export type NewSalesMessage = typeof salesMessages.$inferInsert;
export type SalesSetting = typeof salesSettings.$inferSelect;
export type NewSalesSetting = typeof salesSettings.$inferInsert;
export type SalesSettingsHistory = typeof salesSettingsHistory.$inferSelect;
export type NewSalesSettingsHistory = typeof salesSettingsHistory.$inferInsert;
export type SalesEvalBaseline = typeof salesEvalBaseline.$inferSelect;
export type NewSalesEvalBaseline = typeof salesEvalBaseline.$inferInsert;
export type SalesEvalRun = typeof salesEvalRuns.$inferSelect;
export type NewSalesEvalRun = typeof salesEvalRuns.$inferInsert;
