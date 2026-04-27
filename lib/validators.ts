import { z } from 'zod';

export const githubUrlRegex = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/;

export const SubmissionInput = z.object({
  githubUrl: z.string().regex(githubUrlRegex, 'URL inválida — use https://github.com/usuario/repo'),
  deployedUrl: z
    .string()
    .url('URL inválida')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  comment: z.string().max(500).optional(),
});
export type SubmissionInputT = z.infer<typeof SubmissionInput>;

export const ImprovementItem = z
  .object({
    area: z.string().min(1),
    severity: z.enum(['low', 'medium', 'high']),
    suggestion: z.string().min(1),
    file: z.string().min(1).optional(),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
    codeSnippet: z.string().min(1).optional(),
    proposedFix: z.string().min(1).optional(),
  })
  .refine(
    (imp) => !imp.file || (imp.lineStart !== undefined && !!imp.codeSnippet),
    { message: 'Quando file é informado, lineStart e codeSnippet são obrigatórios' }
  )
  .refine(
    (imp) => imp.lineEnd === undefined || imp.lineStart === undefined || imp.lineEnd >= imp.lineStart,
    { message: 'lineEnd precisa ser >= lineStart' }
  );

export type ImprovementItemT = z.infer<typeof ImprovementItem>;

export const CorrectionDraftInput = z.object({
  grade: z.number().min(0).max(10),
  strengths: z.array(z.string().min(1)).min(1).max(10),
  // Sem teto baixo em improvements: correção honesta de projeto final aponta
  // tudo que tá errado, não limita por estética. 30 é só um circuit breaker
  // pra evitar saída descontrolada por bug do modelo.
  improvements: z.array(ImprovementItem).min(1).max(30),
  narrativeMd: z.string().min(10),
});
export type CorrectionDraftInputT = z.infer<typeof CorrectionDraftInput>;
