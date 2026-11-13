<h1 align="center">T3 Code (ryankhart's fork)</h1>

<p align="center">
  A desktop app for Claude Code, Codex and other coding agents. This fork adds next-prompt buttons, ballots, read-aloud replies and a tidier sidebar on top of T3 Code and MT Code.
</p>

<p align="center">
  <a aria-label="Latest release" href="https://github.com/ryankhart/t3code/releases/latest">
    <img alt="Latest release" src="https://img.shields.io/github/v/release/ryankhart/t3code?style=flat-square&label=Version&labelColor=000000&color=0066CC" />
  </a>
  <a aria-label="License" href="./LICENSE">
    <img alt="License: Apache-2.0" src="https://img.shields.io/badge/License-Apache%202.0-success.svg?style=flat-square&color=33CC12" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/ryankhart/t3code/releases/latest"><b>Download for Windows / Android</b></a>
&ensp;•&ensp;
  <a href="#whats-new-in-this-fork">What's new</a>
&ensp;•&ensp;
  <a href="./FORK.md">How this fork works</a>
&ensp;•&ensp;
  <a href="https://github.com/munimtechnologies/mtcode#readme">MT Code</a>
&ensp;•&ensp;
  <a href="https://github.com/pingdotgg/t3code#readme">T3 Code</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./.github/readme/fork/hero-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="./.github/readme/fork/hero-light.png">
    <img alt="T3 Code with a finished agent run, next-prompt buttons above the message box, and the Working, Snoozed and Settled shelves docked at the bottom of the sidebar" src="./.github/readme/fork/hero-dark.png" width="900">
  </picture>
</p>

## What this is

It's built in three layers:

1. **[T3 Code](https://github.com/pingdotgg/t3code)**, the original app by Theo and the T3 team.
2. **[MT Code](https://github.com/munimtechnologies/mtcode)**, Munim Technologies' fork of T3 Code. It adds a lot on top (Computer Use, realtime voice, a plugin marketplace and more) and merges T3 Code regularly. See [everything MT Code adds](https://github.com/munimtechnologies/mtcode#mt-code-vs-t3-code).
3. **This fork**: the features below, kept as a short stack of commits on top of each MT Code release and rebuilt automatically.

You get everything T3 Code and MT Code do, plus the extras here. The app shows the name "T3 Code", but underneath it's MT Code's build, so it shares MT Code's settings folder (`~/.mt`) and an existing MT Code install upgrades in place.

## What's new in this fork

### Next-prompt buttons

After a run, up to four buttons float above the message box with likely next messages. Click one to add it to your message, click another to add that too, and click again to take one back out. Nothing is sent until you press Send.

<p align="center">
  <img alt="Clicking next-prompt buttons adds each line to the message box, and clicking one again removes it" src="./.github/readme/fork/next-prompt-buttons.gif" width="760">
</p>

- An agent can end its reply with a fenced `options` block, one next message per line. The app hides the block and shows the lines as buttons, instead of a multiple-choice pop-up that covers half the window.
- With the Labs **Suggest next prompt** switch on, the provider's own guess and a small model's picks show up too, including skills and slash commands (a slash command goes first, where it runs).
- **Tab** takes the first suggestion you haven't picked yet, **Escape** hides them.

### Ballots: pick from a page, straight into your message

When an agent shows you choices as an inline page, its **Done** button drops your picks into that thread's message box. It never sends anything: you review the text and press Send yourself.

<p align="center">
  <img alt="Ticking choices on an inline page and pressing Done fills the message box with the picked items as a list" src="./.github/readme/fork/ballot.gif" width="755">
</p>

For agent authors: an `html_render` page calls `t3Compose(text)`, which only adds text, only after a real click, and only to the thread the page is in.

### Titles shimmer while they regenerate

Ask for a new title and the old one shimmers until the new one lands, so you can tell it's about to change.

<p align="center">
  <img alt="Right-clicking a thread, choosing Regenerate title, the title shimmering, then changing to a new one" src="./.github/readme/fork/title-regenerate.gif" width="414">
</p>

### Working, Snoozed and Settled docked in one tray

Working, Snoozed and Settled threads sit together in one slightly raised tray at the bottom of the sidebar, with small uppercase headers, so a long thread list no longer runs straight into them. Each running thread gets a thin blue bar on its left edge.

<p align="center">
  <img alt="The sidebar's Working, Snoozed and Settled shelves in the dark and light themes, with blue bars beside running threads" src="./.github/readme/fork/sidebar-tray.png" width="528">
</p>

### Read replies aloud, and see how much work a run took

A speaker button beside Copy reads the final reply with Microsoft Edge's natural voices. Code blocks are read as "Code block" and file paths as file names. A collapsed run shows how many steps it took.

<p align="center">
  <img alt="A finished reply with the step count next to Worked for 8.1s, and the speaker button beside Copy highlighted" src="./.github/readme/fork/reply-read-aloud-steps.png" width="770">
</p>

Pick the voice in **Settings → General → Read aloud**. It needs the [`edge-tts`](https://github.com/rany2/edge-tts) command (`uv tool install edge-tts`); without it, the basic Windows voice is used.

### Markdown frontmatter as a table

The `---` properties block at the top of a Markdown file shows as a neat table in the file preview instead of raw text.

<p align="center">
  <img alt="The same Markdown file as raw source on the left and as a rendered preview with a properties table on the right" src="./.github/readme/fork/frontmatter-table.png" width="672">
</p>

### And more

| Feature                                       | What it does                                                                                                                                                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chrome extensions in the built-in browser** | Add extensions from the Chrome Web Store with the toolbar's Extensions button. Toolbar ones such as Bitwarden get their own button with their popup. Each browser profile has its own, and they update themselves.                |
| **Settle a thread that's asking a question**  | Settling used to fail while the agent waited on a multiple-choice question. Now Settle dismisses the question, stops that run and settles, from any entry point (sidebar, header, shortcut, phone). Approvals still block Settle. |
| **Move a No project thread into a project**   | A thread started without a project can be filed under an existing project from its menu.                                                                                                                                          |
| **New thread button setting**                 | **Settings → General → Sidebar → New thread button**: "No project" makes New thread start a scratch thread straight away instead of opening the project picker. Shift+click still starts in the current project.                  |
| **Search Google for selected text**           | Right-click selected text and choose **Search Google for "…"** to look it up in your default browser.                                                                                                                             |

### On your phone (Android)

The same features come to the Android app: next-prompt buttons (tap to add, tap again to remove), `options` blocks as buttons, ballots filling the message box, moving a No project thread into a project, the New thread button setting, step counts, shimmering titles, frontmatter tables, and read aloud. Plus these phone-only additions:

| Feature                    | What it does                                                                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Settle from the thread** | A checkmark in the open thread's header settles it and goes back to the list, with Undo for 10 seconds. On a settled thread the checkmark un-settles it. The header's Files, Git and Terminal buttons fold into one ⋮ menu to make room. |
| **Back to where you were** | Going back from a thread scrolls the list to that thread and highlights it once.                                                                                                                                                         |

Read aloud on the phone uses a small speech service on the paired PC (port 3776 over Tailscale), because the phone's own voices are poor. It works over a direct Tailscale connection, not a relay. Details in [FORK.md](./FORK.md#phone-app).

### Fixes

- **Phone app no longer crashes after pairing.** MT Code's computer-task code needs `crypto.getRandomValues`, which the phone's JavaScript engine lacks; this build supplies it.
- **Settling a waiting question can't send the agent a blank answer.** Stop withdraws the question properly instead of answering it empty.

## Download

Get the newest release from **[GitHub Releases](https://github.com/ryankhart/t3code/releases/latest)**:

- **Windows** (x64): `T3-Code-Fork-<version>-x64.exe`
- **Android**: `T3-Code-Fork-<version>.apk`, sideloaded. It installs as a separate app named "T3 Code Fork", next to the official T3 Code app, and pairs with the desktop app like the official one does.

There are no macOS or Linux builds. The Windows installer is unsigned: if SmartScreen warns, choose **More info → Run anyway**.

The desktop app updates itself from this repository's releases. Heads-up: an update installs and restarts the app by itself within about a minute of a release, which stops any agent runs in progress.

Because it uses MT Code's app identity and data folder, it replaces MT Code rather than installing beside it. Your MT Code threads, settings and projects carry over. It does install beside official T3 Code, which uses `~/.t3`.

## Before you start

The app drives agents you already have. Install and sign in to at least one provider CLI:

- Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude`
- Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
- Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
- Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
- OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
- Kiro, Pi, Muse Code, fx and Antigravity work too; see [MT Code's setup list](https://github.com/munimtechnologies/mtcode#before-you-start).

Your existing subscriptions are used directly. Nothing here sells anything, adds accounts, or sends your work anywhere except to the providers you use.

## How it stays up to date

Every four hours a GitHub Actions pipeline checks for a new MT Code release. When there is one, it re-applies this fork's commits on top, runs the tests for the files those commits touch, builds the Windows installer and the Android APK, checks each fork feature is inside the installer, and only then publishes a release. If anything fails, nothing is published and installed copies stay as they are. When MT Code or T3 Code ships its own version of a fork feature, the fork's copy is dropped.

The full explanation, including branches and version numbers, is in [FORK.md](./FORK.md).

## Documentation

- What MT Code adds over T3 Code, and its docs list: [MT Code's README](https://github.com/munimtechnologies/mtcode#readme)
- T3 Code itself: [T3 Code's README](https://github.com/pingdotgg/t3code#readme) and [docs](https://github.com/pingdotgg/t3code/tree/main/docs)
- User guides shipped with this build: [docs/user](./docs/user) (remote access, keyboard shortcuts, permission modes, and more)
- How this fork is built and released: [FORK.md](./FORK.md)
- Building from source: start at [docs/internals/overview.md](./docs/internals/overview.md)

## Reporting problems

This is a one-person fork, public in case the features help someone else; there's no support promise. Problems with a feature listed above belong in [this repository's issues](https://github.com/ryankhart/t3code/issues). Please don't report this fork's problems to [MT Code](https://github.com/munimtechnologies/mtcode/issues) or [T3 Code](https://github.com/pingdotgg/t3code/issues); check first that the problem also happens in their own builds.

## Credits

All the hard work is [T3 Code](https://github.com/pingdotgg/t3code)'s and [MT Code](https://github.com/munimtechnologies/mtcode)'s. This fork exists because both are truly open. Licensed like MT Code: [Apache 2.0](./LICENSE), with T3 Code's parts under [MIT](./LICENSE-MIT); see [NOTICE](./NOTICE).
