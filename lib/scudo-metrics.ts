import { neon } from '@neondatabase/serverless';
import { env } from '@/lib/env';

const RANK_LABELS = [
    'Ferro',
    'Bronze',
    'Prata',
    'Ouro',
    'Platina',
    'Esmeralda',
    'Diamante',
    'Mythril',
    'Mestre',
    'Lendário',
] as const;

type RankLabel = (typeof RANK_LABELS)[number];

const BILLING_HOURS_PER_MONTH = 744;
const BYTES_PER_GB = 1_000_000_000;
const NEON_API_BASE_URL = 'https://console.neon.tech/api/v2';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;

const NEON_CONSUMPTION_METRICS = [
    'compute_unit_seconds',
    'root_branch_bytes_month',
    'child_branch_bytes_month',
    'instant_restore_bytes_month',
    'snapshot_storage_bytes_month',
    'public_network_transfer_bytes',
    'private_network_transfer_bytes',
    'extra_branches_month',
] as const;

type NeonMetricName = (typeof NEON_CONSUMPTION_METRICS)[number];
type NeonPlan = 'launch' | 'scale' | 'agent' | 'enterprise' | 'unknown';

type NeonProject = {
    id: string;
    name?: string;
    org_id?: string;
};

type NeonEndpoint = {
    id?: string;
    host?: string;
};

type NeonProjectContext = {
    orgId: string;
    projectId: string;
    projectName: string | null;
};

type NeonMetricEntry = {
    metric_name?: string;
    value?: unknown;
};

type NeonConsumptionBucket = {
    metrics?: NeonMetricEntry[];
};

type NeonConsumptionPeriod = {
    period_plan?: string;
    consumption?: NeonConsumptionBucket[];
};

type NeonConsumptionProject = {
    project_id?: string;
    periods?: NeonConsumptionPeriod[];
};

type NeonPricing = {
    compute: number;
    rootStorage: number;
    childStorage: number;
    instantRestore: number;
    snapshot: number;
    publicTransfer: number;
    privateTransfer: number;
    extraBranches: number;
    includedChildBranches: number;
};

type ScudoNeonFinanceMetrics = {
    hasData: boolean;
    source: 'consumption_api' | 'missing_key' | 'error';
    estimatedCostUsd30d: number;
    plan: NeonPlan;
    projectId: string | null;
    projectName: string | null;
    computeCostUsd30d: number;
    storageCostUsd30d: number;
    transferCostUsd30d: number;
    branchesCostUsd30d: number;
    computeUnitHours30d: number;
    storageGbMonth30d: number;
    transferGb30d: number;
};

type NeomConsumptionTotals = Record<NeonMetricName, number>;

export interface RankBucket {
    rank: RankLabel;
    count: number;
}

export interface TopStack {
    stack: string;
    count: number;
}

export interface StudentDetails {
    email: string;
    name: string;
    rank: RankLabel;
    appliedJobsCount: number;
    lastAccessAt: string | null;
}

export interface ScudoDashboardMetrics {
    generatedAt: string;
    finance: {
        neon: ScudoNeonFinanceMetrics;
        openAi: {
            hasData: boolean;
            estimatedCostUsd30d: number;
            note: string;
        };
        totalEstimatedCostUsd30d: number;
    };
    students: {
        total: number;
        official: number;
        activeLast24h: number;
        activeLast48h: number;
        activeLast72h: number;
        rankDistribution: RankBucket[];
        appliedJobsTotal: number;
        appliedJobsLast7d: number;
        hasAppliedJobsTracking: boolean;
    };
    jobs: {
        total: number;
        enteredLast24h: number;
        enteredLast7d: number;
        weeklyGoal: number;
        weeklyGoalProgressPct: number;
        available: number;
        unavailable: number;
        topStacks: TopStack[];
    };
    student: StudentDetails | null;
    warnings: string[];
}

let cachedScudoSql: ReturnType<typeof neon> | null = null;
let cachedNeonProjectContext: {
    value: NeonProjectContext | null;
    expiresAt: number;
} | null = null;
let cachedScudoNeonFinance: {
    cacheKey: string;
    value: ScudoNeonFinanceMetrics;
    expiresAt: number;
} | null = null;

function getScudoSql() {
    cachedScudoSql ??= neon(env.SCUDO_DATABASE_URL);
    return cachedScudoSql;
}

function toInt(value: unknown): number {
    if (typeof value === 'number') return Math.trunc(value);
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') {
        const n = Number(value);
        if (Number.isFinite(n)) return Math.trunc(n);
    }
    return 0;
}

function toFloat(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return 0;
}

function toLowerSafe(value: unknown): string {
    return typeof value === 'string' ? value.toLowerCase() : '';
}

function toStringValue(value: unknown, fallback = ''): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
        return String(value);
    }
    return fallback;
}

function toIsoDate(value: unknown): string | null {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }

    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }

    return null;
}

function rankFromOrder(order: number): RankLabel {
    const normalized = Math.min(Math.max(order, 1), RANK_LABELS.length);
    return RANK_LABELS[normalized - 1];
}

function getDefaultNeonFinance(
    source: ScudoNeonFinanceMetrics['source'],
    overrides: Partial<ScudoNeonFinanceMetrics> = {},
): ScudoNeonFinanceMetrics {
    return {
        hasData: false,
        source,
        estimatedCostUsd30d: 0,
        plan: 'unknown',
        projectId: null,
        projectName: null,
        computeCostUsd30d: 0,
        storageCostUsd30d: 0,
        transferCostUsd30d: 0,
        branchesCostUsd30d: 0,
        computeUnitHours30d: 0,
        storageGbMonth30d: 0,
        transferGb30d: 0,
        ...overrides,
    };
}

function normalizeNeonPlan(value: unknown): NeonPlan {
    const raw = toLowerSafe(value);
    if (raw === 'launch' || raw === 'scale' || raw === 'agent' || raw === 'enterprise') {
        return raw;
    }
    return 'unknown';
}

function getNeonPricing(plan: NeonPlan): NeonPricing {
    if (plan === 'launch') {
        return {
            compute: 0.106,
            rootStorage: 0.35,
            childStorage: 0.35,
            instantRestore: 0.2,
            snapshot: 0.09,
            publicTransfer: 0.1,
            privateTransfer: 0,
            extraBranches: 1.5,
            includedChildBranches: 9,
        };
    }

    return {
        compute: 0.222,
        rootStorage: 0.35,
        childStorage: 0.35,
        instantRestore: 0.2,
        snapshot: 0.09,
        publicTransfer: 0.1,
        privateTransfer: 0.01,
        extraBranches: 1.5,
        includedChildBranches: 24,
    };
}

function buildEmptyNeonTotals(): NeomConsumptionTotals {
    return {
        compute_unit_seconds: 0,
        root_branch_bytes_month: 0,
        child_branch_bytes_month: 0,
        instant_restore_bytes_month: 0,
        snapshot_storage_bytes_month: 0,
        public_network_transfer_bytes: 0,
        private_network_transfer_bytes: 0,
        extra_branches_month: 0,
    };
}

function extractScudoEndpointContext() {
    let host = '';
    let endpointId = '';

    try {
        const parsed = new URL(env.SCUDO_DATABASE_URL);
        host = parsed.host.toLowerCase();
        endpointId = host.split('.')[0] ?? '';
    } catch {
        // Ignora parsing inválido e usa fallback vazio.
    }

    return { host, endpointId };
}

async function neonFetchJson<T>(path: string, apiKey: string, search?: Record<string, string>): Promise<T> {
    const url = new URL(`${NEON_API_BASE_URL}${path}`);
    if (search) {
        for (const [key, value] of Object.entries(search)) {
            url.searchParams.set(key, value);
        }
    }

    const response = await fetch(url, {
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        cache: 'no-store',
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Neon API ${response.status}: ${errorText.slice(0, 240)}`);
    }

    return response.json() as Promise<T>;
}

function cacheNeonProjectContext(value: NeonProjectContext | null, ttlMs = TEN_MINUTES_MS) {
    cachedNeonProjectContext = {
        value,
        expiresAt: Date.now() + ttlMs,
    };
}

function resolveConfiguredProjectContext(
    projects: NeonProject[],
    configuredProjectId: string | undefined,
    configuredOrgId: string | undefined,
): NeonProjectContext | null {
    if (!configuredProjectId) {
        return null;
    }

    const found = projects.find((project) => project.id === configuredProjectId);
    if (found) {
        return {
            projectId: found.id,
            projectName: found.name ?? null,
            orgId: configuredOrgId ?? found.org_id ?? '',
        };
    }

    if (!configuredOrgId) {
        return null;
    }

    return {
        projectId: configuredProjectId,
        projectName: null,
        orgId: configuredOrgId,
    };
}

async function resolveProjectByEndpoint(
    projects: NeonProject[],
    apiKey: string,
    endpointContext: { host: string; endpointId: string },
    configuredOrgId: string | undefined,
): Promise<NeonProjectContext | null> {
    for (const project of projects) {
        if (!project.id) {
            continue;
        }

        const endpointResponse = await neonFetchJson<{ endpoints?: NeonEndpoint[] }>(
            `/projects/${project.id}/endpoints`,
            apiKey,
        );

        const hasMatch = (endpointResponse.endpoints ?? []).some((endpoint) => {
            const endpointHost = toLowerSafe(endpoint.host);
            const endpointId = toLowerSafe(endpoint.id);
            return endpointHost === endpointContext.host || endpointId === endpointContext.endpointId;
        });

        if (hasMatch) {
            return {
                orgId: project.org_id ?? configuredOrgId ?? '',
                projectId: project.id,
                projectName: project.name ?? null,
            };
        }
    }

    return null;
}

function resolveProjectByNameFallback(
    projects: NeonProject[],
    configuredOrgId: string | undefined,
): NeonProjectContext | null {
    const fallbackProject = projects.find((project) => {
        const name = toLowerSafe(project.name);
        return name.includes('carrer-quest') || name.includes('career-quest') || name.includes('scudo');
    });

    if (!fallbackProject) {
        return null;
    }

    return {
        orgId: fallbackProject.org_id ?? configuredOrgId ?? '',
        projectId: fallbackProject.id,
        projectName: fallbackProject.name ?? null,
    };
}

async function resolveScudoNeonProjectContext(apiKey: string): Promise<NeonProjectContext | null> {
    if (cachedNeonProjectContext?.expiresAt && cachedNeonProjectContext.expiresAt > Date.now()) {
        return cachedNeonProjectContext.value;
    }

    const projectResponse = await neonFetchJson<{ projects?: NeonProject[] }>('/projects', apiKey);
    const projects = (projectResponse.projects ?? []).filter((project) => Boolean(project.id));

    const configuredProjectId = env.SCUDO_NEON_PROJECT_ID?.trim();
    const configuredOrgId = env.NEON_ORG_ID?.trim();

    const configuredContext = resolveConfiguredProjectContext(projects, configuredProjectId, configuredOrgId);
    if (configuredContext) {
        cacheNeonProjectContext(configuredContext);
        return configuredContext;
    }

    const endpointContext = extractScudoEndpointContext();
    const endpointContextMatch = await resolveProjectByEndpoint(projects, apiKey, endpointContext, configuredOrgId);
    if (endpointContextMatch) {
        cacheNeonProjectContext(endpointContextMatch);
        return endpointContextMatch;
    }

    const fallbackContext = resolveProjectByNameFallback(projects, configuredOrgId);
    if (fallbackContext) {
        cacheNeonProjectContext(fallbackContext);
        return fallbackContext;
    }

    cacheNeonProjectContext(null, 3 * 60 * 1000);
    return null;
}

function getScudoWindow() {
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    const fromDate = new Date(now.getTime() - THIRTY_DAYS_MS);
    return {
        now,
        fromDate,
        fromIso: fromDate.toISOString(),
        toIso: now.toISOString(),
        hoursInWindow: Math.max((now.getTime() - fromDate.getTime()) / (1000 * 60 * 60), 1),
    };
}

function getCachedNeonFinance(cacheKey: string): ScudoNeonFinanceMetrics | null {
    if (
        cachedScudoNeonFinance?.cacheKey === cacheKey &&
        cachedScudoNeonFinance.expiresAt > Date.now()
    ) {
        return cachedScudoNeonFinance.value;
    }

    return null;
}

function cacheNeonFinance(cacheKey: string, value: ScudoNeonFinanceMetrics) {
    cachedScudoNeonFinance = {
        cacheKey,
        value,
        expiresAt: Date.now() + TEN_MINUTES_MS,
    };
}

function extractPlanAndTotals(projectUsage: NeonConsumptionProject) {
    const totals = buildEmptyNeonTotals();
    let plan: NeonPlan = 'unknown';

    for (const period of projectUsage.periods ?? []) {
        const candidatePlan = normalizeNeonPlan(period.period_plan);
        if (plan === 'unknown' && candidatePlan !== 'unknown') {
            plan = candidatePlan;
        }

        for (const bucket of period.consumption ?? []) {
            for (const metric of bucket.metrics ?? []) {
                const metricName = toStringValue(metric.metric_name) as NeonMetricName;
                if (Object.hasOwn(totals, metricName)) {
                    totals[metricName] += toFloat(metric.value);
                }
            }
        }
    }

    return { plan, totals };
}

function calculateNeonFinance(
    context: NeonProjectContext,
    plan: NeonPlan,
    totals: NeomConsumptionTotals,
    hoursInWindow: number,
    warnings: string[],
): ScudoNeonFinanceMetrics {
    const pricing = getNeonPricing(plan);
    const computeUnitHours = totals.compute_unit_seconds / 3600;
    const rootStorageGbMonth = totals.root_branch_bytes_month / BILLING_HOURS_PER_MONTH / BYTES_PER_GB;
    const childStorageGbMonth = totals.child_branch_bytes_month / BILLING_HOURS_PER_MONTH / BYTES_PER_GB;
    const instantRestoreGbMonth = totals.instant_restore_bytes_month / BILLING_HOURS_PER_MONTH / BYTES_PER_GB;
    const snapshotGbMonth = totals.snapshot_storage_bytes_month / BILLING_HOURS_PER_MONTH / BYTES_PER_GB;
    const storageGbMonthTotal = rootStorageGbMonth + childStorageGbMonth + instantRestoreGbMonth + snapshotGbMonth;

    const publicTransferGb = totals.public_network_transfer_bytes / BYTES_PER_GB;
    const privateTransferGb = totals.private_network_transfer_bytes / BYTES_PER_GB;
    const transferGbTotal = publicTransferGb + privateTransferGb;

    const billableBranchHours = Math.max(0, totals.extra_branches_month - pricing.includedChildBranches * hoursInWindow);
    const billableBranchMonths = billableBranchHours / BILLING_HOURS_PER_MONTH;

    const computeCostUsd = computeUnitHours * pricing.compute;
    const storageCostUsd =
        rootStorageGbMonth * pricing.rootStorage +
        childStorageGbMonth * pricing.childStorage +
        instantRestoreGbMonth * pricing.instantRestore +
        snapshotGbMonth * pricing.snapshot;
    const transferCostUsd = publicTransferGb * pricing.publicTransfer + privateTransferGb * pricing.privateTransfer;
    const branchesCostUsd = billableBranchMonths * pricing.extraBranches;

    const estimatedTotal = computeCostUsd + storageCostUsd + transferCostUsd + branchesCostUsd;

    if (plan === 'unknown') {
        warnings.push('Plano da Neon nao identificado. Calculo financeiro usa tabela padrao da documentacao.');
    } else if (plan === 'enterprise') {
        warnings.push('Plano Enterprise pode ter preco customizado; custo Neon da Scudo e estimado.');
    }

    if (publicTransferGb > 0) {
        warnings.push('Custo de transferencia publica da Neon foi estimado sem rateio da franquia global de 500GB da org.');
    }

    return {
        hasData: true,
        source: 'consumption_api',
        estimatedCostUsd30d: estimatedTotal,
        plan,
        projectId: context.projectId,
        projectName: context.projectName,
        computeCostUsd30d: computeCostUsd,
        storageCostUsd30d: storageCostUsd,
        transferCostUsd30d: transferCostUsd,
        branchesCostUsd30d: branchesCostUsd,
        computeUnitHours30d: computeUnitHours,
        storageGbMonth30d: storageGbMonthTotal,
        transferGb30d: transferGbTotal,
    };
}

async function getScudoNeonFinanceMetrics(warnings: string[]): Promise<ScudoNeonFinanceMetrics> {
    const neonApiKey = env.NEON_NAPI_KEY;
    if (!neonApiKey) {
        warnings.push('NEON_NAPI_KEY nao configurada; custo Neon da Scudo nao disponivel.');
        return getDefaultNeonFinance('missing_key');
    }

    try {
        const context = await resolveScudoNeonProjectContext(neonApiKey);
        if (context?.orgId === '' || context?.projectId === '' || !context) {
            warnings.push('Nao foi possivel identificar org_id/project_id da Scudo na API da Neon.');
            return getDefaultNeonFinance('error');
        }

        const window = getScudoWindow();

        const cacheKey = `${context.orgId}:${context.projectId}:${window.fromIso}:${window.toIso}`;
        const cached = getCachedNeonFinance(cacheKey);
        if (cached) {
            return cached;
        }

        const consumption = await neonFetchJson<{ projects?: NeonConsumptionProject[] }>(
            '/consumption_history/v2/projects',
            neonApiKey,
            {
                from: window.fromIso,
                to: window.toIso,
                granularity: 'daily',
                org_id: context.orgId,
                project_ids: context.projectId,
                metrics: NEON_CONSUMPTION_METRICS.join(','),
            },
        );

        const projectUsage = (consumption.projects ?? []).find((project) => project.project_id === context.projectId);
        if (!projectUsage) {
            warnings.push('API da Neon nao retornou dados de consumo para o projeto Scudo no periodo.');
            return {
                ...getDefaultNeonFinance('consumption_api'),
                projectId: context.projectId,
                projectName: context.projectName,
            };
        }

        const { plan, totals } = extractPlanAndTotals(projectUsage);
        const neonFinance = calculateNeonFinance(context, plan, totals, window.hoursInWindow, warnings);

        cacheNeonFinance(cacheKey, neonFinance);
        return neonFinance;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'erro desconhecido';
        warnings.push(`Falha ao consultar consumo da Neon para Scudo: ${message}`);
        return getDefaultNeonFinance('error');
    }
}

async function getStudentDetails(
    scudoSql: ReturnType<typeof neon>,
    studentInput: string,
    hasAppliedJobsTracking: boolean,
): Promise<{ student: StudentDetails | null; warning?: string }> {
    const userRows = (await scudoSql`
      select id, name, email
      from "User"
      where lower(email) = ${studentInput}
      limit 1;
    `) as Array<{ id: unknown; name: unknown; email: unknown }>;

    const user = userRows[0];
    if (!user) {
        return { student: null, warning: 'Aluno especifico nao encontrado para o email informado.' };
    }

    const userId = toStringValue(user.id);
    if (!userId) {
        return { student: null, warning: 'Aluno especifico retornou id invalido.' };
    }

    const rankForUserRows = (await scudoSql`
        select
          coalesce(
            max(
              case
                when lower(p."taskId") like 'ferro-%' then 1
                when lower(p."taskId") like 'bronze-%' then 2
                when lower(p."taskId") like 'prata-%' then 3
                when lower(p."taskId") like 'ouro-%' then 4
                when lower(p."taskId") like 'platina-%' then 5
                when lower(p."taskId") like 'esmeralda-%' then 6
                when lower(p."taskId") like 'diamante-%' then 7
                when lower(p."taskId") like 'mythril-%' then 8
                when lower(p."taskId") like 'mestre-%' then 9
                when lower(p."taskId") like 'lendario-%' then 10
                else null
              end
            ),
            1
          )::int as rank_order
        from "User" u
        left join "UserJornadaTaskProgress" p on p."userId" = u.id
        where u.id = ${userId};
    `) as Array<{ rank_order: unknown }>;

    const accessRows = (await scudoSql`
        select max("updatedAt") as last_access_at
        from "Session"
        where "userId" = ${userId};
    `) as Array<{ last_access_at: unknown }>;

    let appliedJobsCount = 0;
    if (hasAppliedJobsTracking) {
        const userApplicationsRows = (await scudoSql`
          select count(*)::int as total
          from "JobApplication"
          where "userId" = ${userId};
        `) as Array<{ total: unknown }>;
        appliedJobsCount = toInt(userApplicationsRows[0]?.total);
    }

    return {
        student: {
            email: toStringValue(user.email),
            name: toStringValue(user.name),
            rank: rankFromOrder(toInt(rankForUserRows[0]?.rank_order)),
            appliedJobsCount,
            lastAccessAt: toIsoDate(accessRows[0]?.last_access_at),
        },
    };
}

export async function getScudoDashboardMetrics(studentEmail?: string): Promise<ScudoDashboardMetrics> {
    const scudoSql = getScudoSql();
    const warnings: string[] = [];

    const neonFinance = await getScudoNeonFinanceMetrics(warnings);
    const openAiFinance = {
        hasData: false,
        estimatedCostUsd30d: 0,
        note: 'Telemetria de tokens/custos da OpenAI na Scudo ainda nao foi instrumentada.',
    };
    const totalEstimatedCostUsd30d = neonFinance.estimatedCostUsd30d + openAiFinance.estimatedCostUsd30d;

    const studentsRows = (await scudoSql`
    select
      count(*)::int as total,
      count(*) filter (where "officialStudentVerifiedAt" is not null)::int as official
    from "User";
  `) as Array<{ total: unknown; official: unknown }>;

    const activeRows = (await scudoSql`
    select
      count(distinct "userId") filter (where "updatedAt" >= now() - interval '24 hours')::int as active_24h,
      count(distinct "userId") filter (where "updatedAt" >= now() - interval '48 hours')::int as active_48h,
      count(distinct "userId") filter (where "updatedAt" >= now() - interval '72 hours')::int as active_72h
    from "Session";
  `) as Array<{ active_24h: unknown; active_48h: unknown; active_72h: unknown }>;

    const rankRows = (await scudoSql`
    with user_rank as (
      select
        u.id as user_id,
        coalesce(
          max(
            case
              when lower(p."taskId") like 'ferro-%' then 1
              when lower(p."taskId") like 'bronze-%' then 2
              when lower(p."taskId") like 'prata-%' then 3
              when lower(p."taskId") like 'ouro-%' then 4
              when lower(p."taskId") like 'platina-%' then 5
              when lower(p."taskId") like 'esmeralda-%' then 6
              when lower(p."taskId") like 'diamante-%' then 7
              when lower(p."taskId") like 'mythril-%' then 8
              when lower(p."taskId") like 'mestre-%' then 9
              when lower(p."taskId") like 'lendario-%' then 10
              else null
            end
          ),
          1
        ) as rank_order
      from "User" u
      left join "UserJornadaTaskProgress" p on p."userId" = u.id
      group by u.id
    )
    select rank_order, count(*)::int as total
    from user_rank
    group by rank_order
    order by rank_order;
  `) as Array<{ rank_order: unknown; total: unknown }>;

    const rankMap = new Map<number, number>();
    for (const row of rankRows) {
        rankMap.set(toInt(row.rank_order), toInt(row.total));
    }

    const rankDistribution: RankBucket[] = RANK_LABELS.map((rank, i) => ({
        rank,
        count: rankMap.get(i + 1) ?? 0,
    }));

    const jobApplicationTableRows = (await scudoSql`
    select to_regclass('public."JobApplication"') is not null as enabled;
  `) as Array<{ enabled: unknown }>;

    const hasAppliedJobsTracking = Boolean(jobApplicationTableRows[0]?.enabled);
    if (!hasAppliedJobsTracking) {
        warnings.push('Rastreio de candidaturas nao habilitado na SCUDO.');
    }

    let appliedJobsTotal = 0;
    let appliedJobsLast7d = 0;

    if (hasAppliedJobsTracking) {
        const appRows = (await scudoSql`
      select
        count(*)::int as total,
        count(*) filter (where "createdAt" >= now() - interval '7 days')::int as last_7d
      from "JobApplication";
    `) as Array<{ total: unknown; last_7d: unknown }>;

        appliedJobsTotal = toInt(appRows[0]?.total);
        appliedJobsLast7d = toInt(appRows[0]?.last_7d);
    }

    const jobsRows = (await scudoSql`
    select
      count(*)::int as total,
      count(*) filter (where "createdAt" >= now() - interval '24 hours')::int as entered_24h,
      count(*) filter (where "createdAt" >= now() - interval '7 days')::int as entered_7d,
      count(*) filter (where "isActive" = true)::int as available,
      count(*) filter (where "isActive" = false)::int as unavailable
    from "Job";
  `) as Array<{
        total: unknown;
        entered_24h: unknown;
        entered_7d: unknown;
        available: unknown;
        unavailable: unknown;
    }>;

    const topStackRows = (await scudoSql`
    select
      lower(trim(stack_item)) as stack,
      count(*)::int as total
    from "Job" j,
    unnest(j."stack") as stack_item
    where trim(coalesce(stack_item, '')) <> ''
    group by lower(trim(stack_item))
    order by total desc
    limit 8;
  `) as Array<{ stack: unknown; total: unknown }>;

    const topStacks: TopStack[] = topStackRows.map((row) => ({
        stack: toStringValue(row.stack, 'n/a'),
        count: toInt(row.total),
    }));

    const studentInput = studentEmail?.trim().toLowerCase() ?? '';
    let student: StudentDetails | null = null;

    if (studentInput) {
        const result = await getStudentDetails(scudoSql, studentInput, hasAppliedJobsTracking);
        student = result.student;
        if (result.warning) {
            warnings.push(result.warning);
        }
    }

    const weeklyGoal: number = 100;
    const jobsEnteredLast7d = toInt(jobsRows[0]?.entered_7d);

    return {
        generatedAt: new Date().toISOString(),
        finance: {
            neon: neonFinance,
            openAi: openAiFinance,
            totalEstimatedCostUsd30d,
        },
        students: {
            total: toInt(studentsRows[0]?.total),
            official: toInt(studentsRows[0]?.official),
            activeLast24h: toInt(activeRows[0]?.active_24h),
            activeLast48h: toInt(activeRows[0]?.active_48h),
            activeLast72h: toInt(activeRows[0]?.active_72h),
            rankDistribution,
            appliedJobsTotal,
            appliedJobsLast7d,
            hasAppliedJobsTracking,
        },
        jobs: {
            total: toInt(jobsRows[0]?.total),
            enteredLast24h: toInt(jobsRows[0]?.entered_24h),
            enteredLast7d: jobsEnteredLast7d,
            weeklyGoal,
            weeklyGoalProgressPct: weeklyGoal === 0 ? 0 : Math.min(100, Math.round((jobsEnteredLast7d / weeklyGoal) * 100)),
            available: toInt(jobsRows[0]?.available),
            unavailable: toInt(jobsRows[0]?.unavailable),
            topStacks,
        },
        student,
        warnings,
    };
}
