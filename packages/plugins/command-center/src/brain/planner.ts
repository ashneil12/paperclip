/**
 * The planner — how the CEO decomposes an objective into routed, verifiable tasks.
 *
 * LLM-first (the CEO actually reasons about the work), with a deterministic
 * heuristic fallback so the loop still functions (and tests stay hermetic) when
 * no model is wired. Either way the output is a validated Plan.
 */
import type { IdGen, LLM } from "../core/ports";
import type { Objective, Plan, RoleId, Task } from "../core/types";

const KNOWN_ROLES: RoleId[] = ["engineer", "qa", "researcher", "marketer", "designer"];

interface RawTask {
  title?: unknown;
  description?: unknown;
  role?: unknown;
  dependsOn?: unknown;
  acceptanceCriteria?: unknown;
  needsQA?: unknown;
}
interface RawPlan {
  summary?: unknown;
  rationale?: unknown;
  tasks?: unknown;
}

const PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["summary", "tasks"],
  properties: {
    summary: { type: "string" },
    rationale: { type: "string" },
    tasks: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["title", "role", "acceptanceCriteria"],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          role: { type: "string", enum: KNOWN_ROLES },
          dependsOn: { type: "array", items: { type: "integer" }, description: "0-based indices of prerequisite tasks" },
          acceptanceCriteria: { type: "string" },
          needsQA: { type: "boolean" },
        },
      },
    },
  },
};

/** Roles the CEO is allowed to route to (the org's filled non-CEO seats). */
export interface PlannerContext {
  availableRoles: RoleId[];
}

export async function planObjective(
  objective: Objective,
  ctx: PlannerContext,
  newId: IdGen,
  llm?: LLM,
): Promise<Plan> {
  if (llm) {
    try {
      return await planWithLlm(objective, ctx, newId, llm);
    } catch {
      // fall through to heuristic — never let planning hard-fail the loop
    }
  }
  return heuristicPlan(objective, ctx, newId);
}

async function planWithLlm(objective: Objective, ctx: PlannerContext, newId: IdGen, llm: LLM): Promise<Plan> {
  const system =
    `You are the CEO decomposing an objective for your agent team. ` +
    `Available roles: ${ctx.availableRoles.join(", ")}. ` +
    `Return the smallest correct set of tasks. Each task: a clear title, a role from the available list, ` +
    `concrete acceptance criteria, dependsOn as 0-based indices of prerequisite tasks, and needsQA=true for anything user-facing or shippable.`;
  const raw = await llm.completeJSON<RawPlan>({
    system,
    stackId: "operatoros",
    messages: [{ role: "user", content: objective.text }],
    schema: PLAN_SCHEMA,
    parse: (r) => r as RawPlan,
  });
  return coercePlan(objective, raw, ctx, newId);
}

/** Coerce a raw LLM plan into a validated Plan (ids assigned, roles + deps checked). */
export function coercePlan(objective: Objective, raw: RawPlan, ctx: PlannerContext, newId: IdGen): Plan {
  const rawTasks = Array.isArray(raw.tasks) ? (raw.tasks as RawTask[]) : [];
  if (rawTasks.length === 0) return heuristicPlan(objective, ctx, newId);

  // First pass: create tasks with stable ids, keyed by index for dep resolution.
  const ids = rawTasks.map(() => newId("task"));
  const tasks: Task[] = rawTasks.map((rt, i) => {
    const role = normalizeRole(rt.role, ctx);
    const deps = Array.isArray(rt.dependsOn)
      ? (rt.dependsOn as unknown[])
          .map((d) => (typeof d === "number" ? ids[d] : undefined))
          .filter((x): x is string => typeof x === "string" && x !== ids[i])
      : [];
    return {
      id: ids[i]!,
      title: asString(rt.title) || `Task ${i + 1}`,
      description: asString(rt.description) || asString(rt.title) || "",
      role,
      dependsOn: deps,
      acceptanceCriteria: asString(rt.acceptanceCriteria) || "Deliverable meets the objective.",
      needsQA: typeof rt.needsQA === "boolean" ? rt.needsQA : defaultNeedsQA(role),
      status: "planned",
    };
  });

  return {
    objectiveId: objective.id,
    summary: asString(raw.summary) || `Plan for: ${objective.text}`,
    rationale: asString(raw.rationale) || "",
    tasks,
  };
}

/**
 * Deterministic decomposition: keyword routing. Crude but real — it gives the CEO
 * a sane plan with no model, and is the contract the tests pin.
 */
export function heuristicPlan(objective: Objective, ctx: PlannerContext, newId: IdGen): Plan {
  const text = objective.text.toLowerCase();
  const can = (r: RoleId) => ctx.availableRoles.includes(r);
  const tasks: Task[] = [];

  const wantsResearch = /\b(research|find out|investigate|compare|evaluate|figure out)\b/.test(text);
  const wantsCopy = /\b(copy|landing|content|email|launch|ad|reel|post|market)\b/.test(text);
  const wantsBuild = /\b(build|ship|implement|add|fix|create|wire|code|feature|page|api|deploy)\b/.test(text);
  const wantsDesign = /\b(design|mockup|ui|ux|layout|wireframe)\b/.test(text);

  let research: Task | undefined;
  if (wantsResearch && can("researcher")) {
    research = mkTask(newId, "researcher", `Research: ${objective.text}`, "Cited findings that answer the objective, verified vs inferred separated.", false, []);
    tasks.push(research);
  }
  if (wantsDesign && can("designer")) {
    tasks.push(mkTask(newId, "designer", `Design: ${objective.text}`, "Approved layout/mockup for the deliverable.", false, research ? [research.id] : []));
  }
  if ((wantsBuild || (!wantsResearch && !wantsCopy && !wantsDesign)) && can("engineer")) {
    // needsQA=true lets the V2 verify gate auto-spawn QA — no separate qa task here.
    const build = mkTask(newId, "engineer", titleFrom(objective.text, "Build"), "Implemented, checks pass, diff/PR posted.", true, research ? [research.id] : []);
    tasks.push(build);
  }
  if (wantsCopy && can("marketer")) {
    tasks.push(mkTask(newId, "marketer", titleFrom(objective.text, "Copy/Content"), "Conversion copy that passes the anti-AI-writing rules.", true, research ? [research.id] : []));
  }

  if (tasks.length === 0) {
    // No role matched — route to the most general available worker.
    const fallbackRole = ctx.availableRoles[0] ?? "engineer";
    tasks.push(mkTask(newId, fallbackRole, titleFrom(objective.text, "Handle"), "Objective satisfied.", defaultNeedsQA(fallbackRole), []));
  }

  return {
    objectiveId: objective.id,
    summary: `Plan for: ${objective.text}`,
    rationale: "Heuristic decomposition (no model wired).",
    tasks,
  };
}

function mkTask(newId: IdGen, role: RoleId, title: string, ac: string, needsQA: boolean, dependsOn: string[]): Task {
  return { id: newId("task"), title, description: title, role, dependsOn, acceptanceCriteria: ac, needsQA, status: "planned" };
}

function titleFrom(text: string, verb: string): string {
  const t = text.trim();
  return t.length <= 80 ? `${verb}: ${t}` : `${verb}: ${t.slice(0, 77)}…`;
}

function normalizeRole(raw: unknown, ctx: PlannerContext): RoleId {
  const r = asString(raw).toLowerCase() as RoleId;
  if (ctx.availableRoles.includes(r)) return r;
  // Map unknown roles onto something available.
  if (ctx.availableRoles.includes("engineer")) return "engineer";
  return ctx.availableRoles[0] ?? "engineer";
}

function defaultNeedsQA(role: RoleId): boolean {
  return role === "engineer" || role === "marketer" || role === "designer";
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}
