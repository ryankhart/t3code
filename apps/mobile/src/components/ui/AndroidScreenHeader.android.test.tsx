import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

interface Modifier {
  readonly $type: string;
  readonly run?: number;
  readonly handler?: () => void;
}

vi.mock("@expo/ui/jetpack-compose", () => ({
  Column: (props: { readonly children?: ReactNode; readonly modifiers?: Modifier[] }) => (
    <div
      role="button"
      onClick={() => props.modifiers?.find((m) => m.$type === "clickable")?.handler?.()}
    >
      {props.children}
    </div>
  ),
  Text: (props: { readonly children?: ReactNode; readonly modifiers?: Modifier[] }) => (
    <p
      ref={(node) => {
        if (node) Object.assign(node, { modifiers: props.modifiers });
      }}
    >
      {props.children}
    </p>
  ),
  RNHostView: (props: { readonly children?: ReactNode }) => <div>{props.children}</div>,
}));
vi.mock("@expo/ui/jetpack-compose/modifiers", () => ({
  fillMaxWidth: () => ({ $type: "fillMaxWidth" }),
  clickable: (handler: () => void) => ({ $type: "clickable", handler }),
  createModifier: (type: string, params: object) => ({ $type: type, ...params }),
}));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => ({}) }));
vi.mock("react-native", () => ({
  View: (props: { readonly children?: ReactNode }) => <div>{props.children}</div>,
}));
vi.mock("./NativeAppBar.android", () => ({
  NativeAppBar: (props: { readonly title: ReactNode }) => <header>{props.title}</header>,
}));
vi.mock("./AppActivityIndicator", () => ({ AppActivityIndicator: () => null }));
vi.mock("./IconButton", () => ({ IconButton: () => null }));
vi.mock("./AndroidAnchoredMenu.android", () => ({ AndroidAnchoredMenu: () => null }));
vi.mock("./useToolbarLayout", () => ({
  useToolbarLayout: () => ({ height: 48, paddingTop: 0, paddingBottom: 0 }),
}));
vi.mock("./useControlTheme", () => ({ useControlTheme: () => ({ colors: {} }) }));
vi.mock("../../features/settings/appearance/useScaledTextRole", () => ({
  useScaledTextRole: () => ({}),
}));

import { AndroidScreenHeader } from "./AndroidScreenHeader.android";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function marqueeOf(line: Element) {
  return (line as Element & { modifiers?: Modifier[] }).modifiers?.find(
    (m) => m.$type === "t3MarqueeOnce",
  );
}

function mount(title: string, subtitle: string) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = (nextSubtitle: string) =>
    act(() => root.render(<AndroidScreenHeader title={title} subtitle={nextSubtitle} />));
  render(subtitle);
  const tap = () => act(() => container.querySelector<HTMLElement>("[role=button]")!.click());
  const lines = () => {
    const [titleLine, subtitleLine] = container.querySelectorAll("p");
    return { titleLine: titleLine!, subtitleLine: subtitleLine! };
  };
  return { lines, tap, render };
}

it("starts one lap of each line per tap", () => {
  const { lines, tap } = mount("A long thread title", "project · branch");
  expect(marqueeOf(lines().titleLine)).toBeUndefined();
  expect(marqueeOf(lines().subtitleLine)).toBeUndefined();

  tap();
  const first = lines();
  expect(marqueeOf(first.titleLine)?.run).toBe(1);
  expect(marqueeOf(first.subtitleLine)?.run).toBe(1);

  // A tap mid-lap mounts fresh lines, since Compose would keep the running marquee.
  tap();
  const second = lines();
  expect(second.titleLine).not.toBe(first.titleLine);
  expect(second.subtitleLine).not.toBe(first.subtitleLine);
  expect(marqueeOf(second.titleLine)?.run).toBe(2);
  expect(marqueeOf(second.subtitleLine)?.run).toBe(2);
});

it("stops a line's marquee when its text changes", () => {
  const { lines, tap, render } = mount("A long thread title", "project");
  tap();
  render("Reconnecting…");
  expect(marqueeOf(lines().subtitleLine)).toBeUndefined();
  expect(marqueeOf(lines().titleLine)).toBeDefined();
  // The old text coming back doesn't scroll again without a tap.
  render("project");
  expect(marqueeOf(lines().subtitleLine)).toBeUndefined();
});
