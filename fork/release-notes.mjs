// One line per user-facing change since the last fork release.
// Usage: node fork/release-notes.mjs <base-tag> <version> [ref]
// Rebasing onto each MT Code release changes SHAs, so commits match by subject.
import * as NodeChildProcess from "node:child_process";

const [baseTag, version, ref = "HEAD"] = process.argv.slice(2);
if (!baseTag || !version) {
  console.error("usage: node fork/release-notes.mjs <base-tag> <version> [ref]");
  process.exit(1);
}

const git = (...args) =>
  NodeChildProcess.execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
const lines = (text) => (text ? text.split("\n") : []);
const subjects = (range) => lines(git("log", "--no-merges", "--format=%s", ...range));

const parts = (v) => v.replace(/^v/, "").split(".").map(Number);
const older = (a, b) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
};
// Upstream T3 Code's v* tags may be present too, so ask GitHub for this fork's releases.
const repo = process.env.GITHUB_REPOSITORY ?? "ryankhart/t3code";
const releases = JSON.parse(
  NodeChildProcess.execFileSync(
    "gh",
    ["release", "list", "-R", repo, "-L", "50", "--json", "tagName"],
    {
      encoding: "utf8",
    },
  ),
).map((release) => release.tagName);
const previousTag = releases
  .filter((tag) => older(tag, version))
  .sort((a, b) => (older(a, b) ? 1 : -1))[0];
if (previousTag) {
  try {
    git("rev-parse", "-q", "--verify", `refs/tags/${previousTag}`);
  } catch {
    git("fetch", "-q", "--no-tags", "origin", `+refs/tags/${previousTag}:refs/tags/${previousTag}`);
  }
}
const previousBase =
  previousTag && git("describe", "--tags", "--match", "munim-v*", "--abbrev=0", previousTag);
const shipped = new Set(previousTag ? subjects([previousTag, `^${previousBase}`]) : []);

// Leaves names like "iOS" and "preview_navigate" alone.
const capital = (text) =>
  /^[a-z][a-z'-]*(?=[\s,:.]|$)/.test(text) ? text.charAt(0).toUpperCase() + text.slice(1) : text;
const groups = { feat: [], fix: [], perf: [] };
for (const subject of subjects([ref, `^${baseTag}`]).reverse()) {
  if (shipped.has(subject)) continue;
  const match = /^(\w+)(?:\(([^)]*)\))?!?:\s*(.+)$/.exec(subject);
  const type = match?.[1] ?? "feat";
  const text = capital((match?.[3] ?? subject).replace(/\s*\(#\d+\)$/, ""));
  const line = match?.[2] === "mobile" ? `Phone app: ${text}` : text;
  groups[type]?.push(type === "perf" ? `Faster: ${line}` : line);
}
groups.fix.push(...groups.perf);
const mtVersion = (tag) => tag.replace(/^munim-v/, "");
// MT Code's notes are a bullet per commit; keep the bullets, drop merges.
const mtCodeChanges = (tag) => {
  try {
    const body = NodeChildProcess.execFileSync(
      "gh",
      ["release", "view", tag, "-R", "munimtechnologies/mtcode", "--json", "body", "-q", ".body"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    // Only the first bullet list; the footer's bullets are about the build.
    const all = lines(body.replace(/\r/g, ""));
    const start = all.findIndex((line) => line.startsWith("- "));
    const end = all.findIndex((line, i) => i > start && !line.startsWith("- "));
    return (start < 0 ? [] : all.slice(start, end < 0 ? undefined : end))
      .filter((line) => !/^- Merge /.test(line))
      .map((line) => line.slice(2).replace(/^\w+(?:\([^)]*\))?!?:\s*/, ""))
      .map((text) => `- ${capital(text.replace(/\s*\(#\d+\)$/, ""))}`);
  } catch {
    return [];
  }
};
const out = [];
if (groups.feat.length) out.push("## New", ...groups.feat.map((t) => `- ${t}`), "");
if (groups.fix.length) out.push("## Fixed", ...groups.fix.map((t) => `- ${t}`), "");
if (!groups.feat.length && !groups.fix.length) {
  out.push("No changes to this fork's own features since the last release.", "");
}
if (previousBase && previousBase !== baseTag) {
  // Every MT Code release since the previous base, when several came out between our builds.
  const tags = lines(git("tag", "-l", "munim-v*", "--sort=version:refname"));
  const span = tags.slice(tags.indexOf(previousBase) + 1, tags.indexOf(baseTag) + 1);
  const changes = [...new Set((span.length ? span : [baseTag]).flatMap(mtCodeChanges))];
  out.push(
    `## From MT Code ${mtVersion(baseTag)} (was ${mtVersion(previousBase)})`,
    ...(changes.length
      ? changes
      : [
          `- [MT Code's notes](https://github.com/munimtechnologies/mtcode/releases/tag/${baseTag})`,
        ]),
    "",
  );
}
out.push(
  `Built from MT Code ${mtVersion(baseTag)} plus this fork's ${subjects([ref, `^${baseTag}`]).length} commits. See [FORK.md](https://github.com/ryankhart/t3code/blob/main/FORK.md).`,
);
console.log(out.join("\n").trim());
