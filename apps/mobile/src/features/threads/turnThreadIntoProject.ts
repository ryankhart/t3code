import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import { threadHasScratchFolder, threadMoveNote } from "@t3tools/client-runtime/state/projects";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { AuthOrchestrationOperateScope, ProjectId, type ServerConfig } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import * as Haptics from "expo-haptics";
import { msg } from "gt-react-native";
import { useMemo } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { m } from "../../i18n/messages";
import { appAtomRegistry } from "../../state/atom-registry";
import { useEnvironmentServerConfig } from "../../state/entities";
import { environmentProjects, projectEnvironment } from "../../state/projects";
import { readEnvironmentScope } from "../../state/session";
import { showThreadActionNotice } from "./thread-action-notice";
import { resolveThreadMoveTargets, type ThreadMoveTarget } from "./thread-move-targets";

type ThreadProjectRef = Pick<
  EnvironmentThreadShell,
  "environmentId" | "projectId" | "worktreePath"
>;

/** A No project thread that already has its own folder, on a server that can promote it. */
function canPromoteThread(
  thread: ThreadProjectRef,
  config: ServerConfig | undefined,
  project: EnvironmentProject | null | undefined,
): boolean {
  if (thread.worktreePath === null) return false;
  if (config?.environment.capabilities.threadProjectFromScratch !== true) return false;
  return project?.isScratch === true;
}

export async function turnThreadIntoProject(thread: EnvironmentThreadShell): Promise<void> {
  const title = m(msg("Could not turn thread into a project"));
  if (!readEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope)) {
    Dialog.alert(title, m(msg("This connection cannot change threads.")));
    return;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  const result = await runAtomCommand(
    appAtomRegistry,
    projectEnvironment.createFromThread,
    { environmentId: thread.environmentId, input: { threadId: thread.id } },
    { reportFailure: false },
  );
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    Dialog.alert(title, errorDisplayMessage(error, m) ?? m(msg("Try again.")));
  }
}

const NO_MOVE_TARGETS: ReadonlyArray<ThreadMoveTarget> = [];

const NO_PROJECTS_ATOM = Atom.make<ReadonlyArray<EnvironmentProject>>([]).pipe(
  Atom.withLabel("mobile:thread-move:no-projects"),
);

/**
 * Whether a thread row offers "Turn into project", and the projects its "Move to project"
 * submenu lists (for any thread with its own No project folder). Each row watches only its own
 * project and server config; just the rare thread that can move also watches the project list,
 * so the menu stays current without every row re-rendering on any project change.
 */
export function useThreadProjectActions(thread: ThreadProjectRef): {
  readonly canTurnIntoProject: boolean;
  readonly moveTargets: ReadonlyArray<ThreadMoveTarget>;
} {
  const { environmentId, projectId, worktreePath } = thread;
  const config = useEnvironmentServerConfig(environmentId) ?? undefined;
  const project = useAtomValue(environmentProjects.projectAtom({ environmentId, projectId }));
  const promotable = canPromoteThread({ environmentId, projectId, worktreePath }, config, project);
  const scratchRoot = config?.scratchWorkspaceRoot;
  const movable =
    config?.environment.capabilities.threadProjectFromScratch === true &&
    threadHasScratchFolder({ worktreePath }, project, scratchRoot);
  const projects = useAtomValue(movable ? environmentProjects.projectsAtom : NO_PROJECTS_ATOM);
  return useMemo(
    () => ({
      canTurnIntoProject: promotable,
      moveTargets: movable
        ? resolveThreadMoveTargets(
            { environmentId, projectId, worktreePath },
            projects,
            scratchRoot,
          )
        : NO_MOVE_TARGETS,
    }),
    [promotable, movable, environmentId, projectId, worktreePath, projects, scratchRoot],
  );
}

/**
 * Moves a No project thread into an existing project. The server makes the project folder its
 * working folder, or says why it kept its own.
 */
export async function moveThreadToProject(
  thread: EnvironmentThreadShell,
  projectId: string,
): Promise<boolean> {
  const title = "Could not move thread to the project";
  if (!readEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope)) {
    Dialog.alert(title, "This connection cannot change threads.");
    return false;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  const result = await runAtomCommand(
    appAtomRegistry,
    projectEnvironment.moveThread,
    {
      environmentId: thread.environmentId,
      input: { threadId: thread.id, projectId: ProjectId.make(projectId) },
    },
    { reportFailure: false },
  );
  if (result._tag === "Success") {
    // As on desktop, confirm where the thread went: it leaves No project for that project.
    const project = appAtomRegistry.get(
      environmentProjects.projectAtom({
        environmentId: thread.environmentId,
        projectId: ProjectId.make(projectId),
      }),
    );
    showThreadActionNotice({
      phase: "success",
      label: project ? `Moved to ${project.title}` : "Moved to project",
      description: threadMoveNote(result.value),
    });
    return true;
  }
  if (!isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    Dialog.alert(title, error instanceof Error ? error.message : "Try again.");
  }
  return false;
}
