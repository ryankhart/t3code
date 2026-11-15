import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";

export interface ThreadMoveTarget {
  readonly id: EnvironmentProject["id"];
  readonly title: string;
}

/**
 * Projects a No project thread can move to, as on desktop: same environment, a real project
 * (not the No project folder, whether flagged or found by the server's scratch root), not
 * archived. Pinned projects first, then by title. A thread filed under a project while it kept
 * its own folder is offered that project too, so picking it finishes the move.
 */
export function resolveThreadMoveTargets(
  thread: {
    readonly environmentId: string;
    readonly projectId: string;
    readonly worktreePath: string | null;
  },
  projects: ReadonlyArray<EnvironmentProject>,
  scratchWorkspaceRoot?: string | null,
): ReadonlyArray<ThreadMoveTarget> {
  return projects
    .filter(
      (project) =>
        project.environmentId === thread.environmentId &&
        (project.id !== thread.projectId || thread.worktreePath !== null) &&
        project.isScratch !== true &&
        project.archivedAt == null &&
        !isScratchProject(project, scratchWorkspaceRoot),
    )
    .sort(
      (a, b) =>
        Number(b.pinnedAt != null) - Number(a.pinnedAt != null) ||
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    )
    .map((project) => ({ id: project.id, title: project.title }));
}

const MOVE_TO_PROJECT_EVENT_PREFIX = "move-to-project:";

export function moveToProjectMenuEventId(projectId: string): string {
  return `${MOVE_TO_PROJECT_EVENT_PREFIX}${projectId}`;
}

/** The project id a "Move to project" menu event picked, or null for any other event. */
export function parseMoveToProjectMenuEvent(event: string): string | null {
  if (!event.startsWith(MOVE_TO_PROJECT_EVENT_PREFIX)) return null;
  const projectId = event.slice(MOVE_TO_PROJECT_EVENT_PREFIX.length);
  return projectId.length > 0 ? projectId : null;
}
