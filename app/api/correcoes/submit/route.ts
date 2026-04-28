import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { asService } from '@/lib/db-context';
import { submissions } from '@/drizzle/schema';
import { SubmissionInput } from '@/lib/validators';
import { processSubmissionWithAI } from '@/lib/ai-processor';
import { checkSubmitRateLimit, getClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
// Student-facing response returns fast (~100ms); AI correction runs in background
// via waitUntil. Pior caso: fetches GitHub sequenciais + 19 blobs + OpenAI gen
// + polisher pode passar de 90s. 300s = mesmo budget do cron e dá folga pros
// AbortSignal.timeout() internos dispararem antes do kill da Vercel — sem isso
// a função morre sem entrar no catch e a submission fica órfã em 'processing'.
export const maxDuration = 300;

export async function POST(req: Request) {
  // Rate limit por IP — endpoint público dispara pipeline de IA caro
  // (~$0.05–$0.10 por submit). Sem freio, é vetor de cost-amplification:
  // script trivial gera centenas de USD de custo OpenAI numa noite.
  const ip = getClientIp(req);
  const rl = await checkSubmitRateLimit(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: 'muitos envios em pouco tempo. Tenta de novo daqui a alguns minutos.',
      },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = SubmissionInput.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'dados inválidos', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { githubUrl, deployedUrl } = parsed.data;

  // We no longer collect email from the student (anonymous flow), but the DB
  // column is notNull for back-compat + audit. Generate a stable placeholder
  // that's obviously synthetic so nobody mistakes it for a real address.
  const anonEmail = `anon-${randomUUID()}@public.dobro-support`;

  const [created] = await asService(async (tx) =>
    tx
      .insert(submissions)
      .values({
        studentEmail: anonEmail,
        githubUrl,
        deployedUrl: deployedUrl ?? null,
        status: 'queued',
        // Toda nova submissão é DevQuest 2.0 — 1.0 é legado, alunos novos
        // nem sabem que existiu. Em v1.2 esse valor será derivado de
        // challenge_id quando o aluno selecionar o desafio explicitamente.
        courseVersion: '2.0',
        clientIp: ip,
      })
      .returning()
  );

  // Fire AI correction in background. waitUntil keeps the serverless function
  // alive past the response, and processSubmissionWithAI never throws —
  // failures are written back to the submission row as status=failed.
  waitUntil(processSubmissionWithAI(created.id));

  return NextResponse.json({ ok: true, id: created.id });
}
