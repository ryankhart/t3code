# This fork

A personal build of [T3 Code](https://github.com/pingdotgg/t3code) that combines three things:

1. **T3 Code** itself.
2. **[MT Code](https://github.com/munimtechnologies/mtcode)**, a fork of T3 Code that adds its own features and merges T3 Code regularly.
3. **This fork's own features and fixes**, kept as a short stack of commits on top.

The app shows the name "T3 Code". Internally it's MT Code's "munim" build, so it shares MT Code's settings folder (`~/.mt`) and Windows app identity, and an existing MT Code install upgrades in place.

## How updates work

The [Fork sync and build](.github/workflows/fork-build.yml) workflow runs every four hours:

1. If MT Code published a new `munim-v*` release, it re-applies this fork's commits on top of it. Commits listed in [`fork/now-in-mtcode.txt`](fork/now-in-mtcode.txt) are left out once the release contains the upstream commit that replaces them. A conflict in `README.md` always keeps this fork's version. Any other conflict is resolved by Claude Code (see [`fork/resolve-conflicts-prompt.md`](fork/resolve-conflicts-prompt.md)); if it can't, the run stops.
2. On a Windows runner it installs dependencies, runs the tests and typechecks for every file the fork's commits touch, and builds the installer.
3. It checks that each fork feature is inside the installer ([`fork/installer-markers.txt`](fork/installer-markers.txt)), then publishes a GitHub release with the installer and `latest.yml`. Its notes ([`fork/release-notes.mjs`](fork/release-notes.mjs)) list one line per `feat`, `fix` or `perf` commit that is new since the previous release, taken from the commit subject, so write subjects a user would understand. When the MT Code base moved, they also list MT Code's own changes from its release notes.
4. Only then does the rebased branch replace `main`.
5. On a Linux runner it builds the phone app from the same commit and attaches `T3-Code-Fork-<version>.apk` to that release. If this step fails, the desktop release stays and the failure issue says the APK is missing.

The desktop app's update button reads this repository's releases, so one click installs a build that has already passed. If a step before publishing fails, nothing is published, installed copies stay where they are, and the workflow opens an issue labelled `fork-pipeline`.

Pushing a new commit to `main` also builds and publishes a release, unless nothing but docs changed since the last release (Markdown files at the top level, `docs/` and `.github/readme/`). Docs-only changes go out with the next build; run the workflow with **force_build** to release them sooner.

## Branches and versions

- `main` (default): the latest MT Code release plus this fork's commits.
- `main-next`: a rebased candidate that hasn't been published yet.
- There is no branch mirroring T3 Code or MT Code: the pipeline fetches MT Code's release tags straight from MT Code. (Until 2026-11-09 `main` was a stale copy of T3 Code's `main` and this fork's branch was called `custom`.)
- Release versions turn MT Code's `x.y.z` into `x.y.(z×100+n)`, where `n` counts rebuilds on that release. For example, MT Code 0.1.52 becomes 0.1.5200, the next rebuild 0.1.5201, and MT Code 0.1.53 becomes 0.1.5300. Each new version sorts above the last, so the updater always offers it.

## Phone app

The fork's desktop features, ported to the Android app (`apps/mobile`). It is sideloaded as a separate app named "T3 Code Fork" (the `preview` variant, package `com.t3tools.t3code.preview`), so it sits beside the official app.

- **Next-prompt buttons:** 2–4 buttons above the message box after a run. A reply's `options` block shows as buttons and is hidden from the reply. With the Labs "Suggest next prompt" switch on, the provider's prediction and the small model's picks show too. A tap adds it to the message, after a blank line when there is already text (a slash command goes first, where it runs), and a second tap takes it back out; it never sends. The buttons stay up while you type, so you can pick several.
- **Ballots fill the message box:** a ballot (an inline page where you mark choices) has a Done button that calls `t3Compose(text)` to append your picks to that thread's draft, only after a real tap (at most 4 requests and 20,000 characters per tap). It works inline and full screen. An inline ballot's frame grows to fit its page (up to 20,000 px tall), so dragging over it scrolls the chat instead of the ballot's inside, the part you tapped stays put when a pick makes the page grow, and a note field you tap is lifted above the keyboard.
- **Move to project:** a thread started under No project can move into an existing project from its menu, also after Turn into project. It then works in the project's folder, and its conversation resumes there.
- **New thread button:** a setting (Settings > General) that makes New thread start a No project thread without the picker.
- **Start without a project:** a new thread's "What should we build in <project>?" heading has an "or start without a project" link under it, as on desktop, so switching to No project takes one tap instead of two.
- **Folded turns** show their step count, **titles shimmer** while they regenerate, and **Markdown frontmatter** shows as a table.
- **Settle from the thread (phone only):** a checkmark in the open thread's header settles it and goes back to the list. The list's Undo stays up 10 s (longer if Android's accessibility timeout asks for it), and Undo brings the row back and points it out. On a settled thread the checkmark is highlighted and un-settles it. To make room, the header's Files, Git and Terminal buttons move into one ⋮ menu on phones, which also has every action the thread's list row offers (rename, regenerate title, snooze, pin, archive, copy and the rest), in the same order and wording as desktop.
- **Back to where you were:** going back from a thread scrolls the list so that thread's row is fully visible, then pulses its background once (about 1.5 s; with Reduce Motion, a still highlight). A thread that just went into the folded Settled shelf pulses the shelf header instead, only if it's already on screen. The shelf never opens by itself.
- **Previous / Next prompt:** round ↑ and ↓ buttons at the right edge (↓ just left of ↑), level with the **Bottom** pill (desktop: Scroll to end). ↑ first scrolls up to the prompt of the reply you're reading, then one prompt earlier per tap; ↓ goes one prompt later per tap. Above the first loaded prompt, ↑ goes to the very top, where Load earlier activity sits. ↑ hides at the top of the chat, ↓ at the last prompt; each keeps its spot when the other hides. On the desktop app too.
- **Digital assistant (Android):** the app can be picked under Android's Settings > Apps > Default apps > Digital assistant app (Settings > Voice in the app shows whether it is, and opens that screen). The assistant gesture, such as holding the side button, then opens a new thread without a project in talk mode (below). Using the gesture again starts over in another new thread. If the app had to be started, it waits up to 8 seconds for the connection; if no connected environment offers threads without a project, it opens the new-thread screen instead. Nothing happens unless the app is the chosen assistant. The code is in `apps/mobile/modules/t3-assistant` and `apps/mobile/src/features/assistant`.
- **Talk mode (phone app):** a spoken conversation in a thread, started by the assistant gesture. It listens, sends what was said after a 1.5-second pause, reads the finished reply to that message aloud with the read-aloud voice, then listens again. Replies are read aloud only over a direct Tailscale connection to the PC; over a relay it explains that and leaves what was said in the message box instead of sending it, and over a plain LAN address it sends but the reply can't be read aloud (the voice service listens only on Tailscale). Each spoken message carries a note, added as it is queued, asking the agent for one to three short spoken sentences; message views, find in thread, search results, queued messages, prompt recall, thread titles and scratch folder names leave the note out (`TALK_MODE_INSTRUCTION` in `packages/shared/src/composerContextReferences.ts`). A bar above the composer shows the step and stops talk mode. It also ends when nothing is said for 15 seconds, the agent's run stops or fails, 10 seconds pass without the message being picked up or queued behind a running turn (for example it was taken out of the queue), a reply is stopped or has nothing to say, something is typed while it answers, the thread is left, the app goes to the background, the agent asks a question or needs an approval, or a queued message is opened for editing. Code: `apps/mobile/src/features/talk-mode`, with pause detection in `apps/mobile/src/features/voice-input/endOfSpeech.ts`.
- **Read aloud:** a speaker button on replies plays Microsoft Edge's natural voices. They are made by a small service on the paired PC (port 3776 over Tailscale), not by the phone, whose own voices are poor. Pick the voice in Settings > Voice. It works only over a direct (Tailscale) connection, not a relay.

Each release's APK is signed with the fork's own key, so it installs over the previous one; its version name is the release version and its Android version code comes from it (0.1.5301 becomes 105301). Over-the-air updates are off in these builds, because upstream's would replace the fork's features.

- **Updates itself:** at launch, and when you come back after 30 minutes or more away, the app checks this repository's latest release. On Wi-Fi (any network Android doesn't call metered), it downloads a newer APK, checks its SHA-256 against the release, and installs it the next time you leave the app, with no prompts; the next launch is the new version. Android needs "Install unknown apps" allowed for T3 Code Fork once, and the app asks for it the first time an update is ready. Only release builds do this, because the build sets `EXPO_PUBLIC_T3_APK_UPDATES_REPO`. If Android still wants a tap, its install screen opens when you return. The code is in `apps/mobile/modules/t3-apk-updater` and `apps/mobile/src/features/updates/apk-updates.ts`.

The phone app needs `crypto.getRandomValues`, which Hermes lacks; `apps/mobile/src/lib/cryptoPolyfill.ts` provides it.

## Repository secrets

- `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD`: the phone app's signing key (alias `t3codefork`). Keep the key: Android refuses an update signed with a different one.
- `CLAUDE_CODE_OAUTH_TOKEN`: from `claude setup-token`, used only to resolve merge conflicts.
- `FORK_PUSH_TOKEN`: a fine-grained token for this repository with Contents and Workflows read/write. The built-in token can't push branches whose commits change `.github/workflows`, and every MT Code release does.

All other workflows inherited from T3 Code and MT Code are switched off by the pipeline.
