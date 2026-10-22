// The open-questions read (0.33.0): the "Open questions" items of every component and subsystem about of an environment, as a draft would leave it (`?draft=`).
// One pure extractor in core/open-questions.ts; REST is GET /api/envs/:env/open-questions, MCP is list_open_questions.

import type { Ctx } from './context.ts';
import { collectQuestions, type Question } from '../core/open-questions.ts';
import { subsystemsFor } from './subsystems-read.ts';

export function questionsFor(ctx: Ctx, env: string, draft: string | null): { count: number; questions: Question[] } {
  const subsystems = subsystemsFor(ctx, env, draft).subsystems, g = ctx.view(env, draft).g;
  const questions = collectQuestions(subsystems, g.model.services);
  return { count: questions.length, questions };
}
