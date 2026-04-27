import { z } from "zod";
import { loadState, nowIso, withState, type Team } from "../state.js";
import { handleTaskStop } from "./tasks.js";

export const TeamCreateInputSchema = z.object({ name: z.string().min(1) });
export const handleTeamCreate = async (
  raw: unknown,
  deps: { statePath?: string },
): Promise<Team> => {
  const { name } = TeamCreateInputSchema.parse(raw);
  const opts = deps.statePath ? { path: deps.statePath } : {};
  const out = await withState(async (s) => {
    if (!s.teams[name]) {
      s.teams[name] = { name, createdAt: nowIso() };
    }
    return { state: s, result: s.teams[name]! };
  }, opts);
  return out!;
};

export const TeamDeleteInputSchema = z.object({
  name: z.string().min(1),
  force: z.boolean().default(false),
});
export type TeamDeleteInput = z.infer<typeof TeamDeleteInputSchema>;

export interface TeamDeleteResult {
  deleted: boolean;
  stoppedMembers: string[];
}

export const handleTeamDelete = async (
  raw: unknown,
  deps: { statePath?: string },
): Promise<TeamDeleteResult> => {
  const input = TeamDeleteInputSchema.parse(raw);
  const opts = deps.statePath ? { path: deps.statePath } : {};
  const before = loadState(opts);
  if (!before.teams[input.name]) {
    return { deleted: false, stoppedMembers: [] };
  }
  const liveMembers = Object.values(before.tasks).filter(
    (t) => t.team === input.name && t.status === "running",
  );
  if (liveMembers.length > 0 && !input.force) {
    throw new Error(
      `TeamDelete: team '${input.name}' has ${liveMembers.length} running member(s); pass force:true to stop them`,
    );
  }
  const stopped: string[] = [];
  for (const t of liveMembers) {
    try {
      await handleTaskStop({ id: t.id }, deps);
      stopped.push(t.id);
    } catch {
      /* keep going; reconciliation will catch leftovers */
    }
  }
  await withState(async (s) => {
    delete s.teams[input.name];
    for (const t of Object.values(s.tasks)) {
      if (t.team === input.name) {
        s.tasks[t.id] = { ...t, team: undefined, updatedAt: nowIso() };
      }
    }
    return s;
  }, opts);
  return { deleted: true, stoppedMembers: stopped };
};
