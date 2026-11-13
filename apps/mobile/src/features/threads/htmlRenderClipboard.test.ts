import { describe, expect, it } from "vite-plus/test";

import {
  HTML_RENDER_CLIPBOARD_SCRIPT,
  htmlRenderClipboardReply,
  readHtmlRenderClipboardMessage,
} from "./htmlRenderClipboard";

const run = (options: { active: boolean | null }) => {
  const posted: string[] = [];
  let announce = () => {};
  const firstPost = new Promise<void>((resolve) => (announce = resolve));
  class UserActivation {
    get isActive() {
      return options.active === true;
    }
  }
  const window: Record<string, unknown> = {
    ReactNativeWebView: {
      postMessage: (data: string) => {
        posted.push(data);
        announce();
      },
    },
  };
  const navigator: Record<string, unknown> =
    options.active === null ? {} : { userActivation: new UserActivation() };
  new Function("window", "navigator", HTML_RENDER_CLIPBOARD_SCRIPT)(window, navigator);
  const clipboard = navigator.clipboard as {
    writeText(text: string): Promise<void>;
    write(items: unknown[]): Promise<void>;
  };
  const reply = (id: number, ok: boolean) =>
    new Function("window", htmlRenderClipboardReply(id, ok))(window);
  return { posted, firstPost, clipboard, reply };
};

describe("html render clipboard shim", () => {
  it("hands the text to the app and settles with its answer", async () => {
    const { posted, clipboard, reply } = run({ active: true });
    const copied = clipboard.writeText('a","id":9');
    const request = readHtmlRenderClipboardMessage(posted[0]!);
    expect(request).toEqual({ id: 1, text: 'a","id":9' });
    reply(request!.id, true);
    await expect(copied).resolves.toBeUndefined();

    const failed = clipboard.writeText("b");
    reply(readHtmlRenderClipboardMessage(posted[1]!)!.id, false);
    await expect(failed).rejects.toThrow("Copy failed");
  });

  it("copies the plain text of a ClipboardItem", async () => {
    const { posted, firstPost, clipboard, reply } = run({ active: null });
    const copied = clipboard.write([{ getType: async () => new Blob(["from item"]) }]);
    await firstPost;
    expect(readHtmlRenderClipboardMessage(posted[0]!)).toEqual({ id: 1, text: "from item" });
    reply(1, true);
    await expect(copied).resolves.toBeUndefined();
  });

  it("refuses without a recent tap", async () => {
    const { posted, clipboard } = run({ active: false });
    await expect(clipboard.writeText("x")).rejects.toThrow("Copying needs a tap");
    expect(posted).toEqual([]);
  });

  it("ignores other messages", () => {
    expect(readHtmlRenderClipboardMessage("not json")).toBeNull();
    expect(
      readHtmlRenderClipboardMessage('{"type":"t3-html-render-overflow","x":true}'),
    ).toBeNull();
    expect(
      readHtmlRenderClipboardMessage('{"type":"t3-html-render-clipboard","id":"1","text":"a"}'),
    ).toBeNull();
  });
});
