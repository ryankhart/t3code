import { describe, expect, it } from "vite-plus/test";

import { isScratchProject, threadHasScratchFolder } from "./projects.ts";

describe("threadHasScratchFolder", () => {
  const scratchRoot = "C:\\Users\\me\\.t3\\scratch";
  const folder = `${scratchRoot}\\2026-01-01-notes-a1b2c3d4`;

  it.each([
    ["under No project", folder, scratchRoot, true],
    ["turned into a project of its own folder", null, folder, true],
    ["moved to a project, keeping its folder", folder.toUpperCase(), "C:\\work\\app", true],
    ["under No project without a folder", null, scratchRoot, false],
    ["in a project's root", null, "C:\\work\\app", false],
    ["in a project's worktree", "C:\\work\\worktrees\\app\\t3-1", "C:\\work\\app", false],
    ["nested deeper than its own folder", `${folder}\\sub`, scratchRoot, false],
  ])("%s", (_name, worktreePath, workspaceRoot, expected) => {
    expect(threadHasScratchFolder({ worktreePath }, { workspaceRoot }, scratchRoot)).toBe(expected);
  });

  it("is false where the environment has no No project folder", () => {
    expect(threadHasScratchFolder({ worktreePath: folder }, null, null)).toBe(false);
  });
});

describe("isScratchProject", () => {
  it.each([null, undefined])(
    "recognises a loaded scratch project when its environment offers no available root (%s)",
    (scratchWorkspaceRoot) => {
      const project = { workspaceRoot: "/remote/scratch", isScratch: true as const };

      expect(isScratchProject(project, scratchWorkspaceRoot)).toBe(true);
    },
  );
});
