import { describe, expect, it } from "vite-plus/test";

import { chromeWebStoreExtensionId } from "./chromeWebStore.ts";

const BITWARDEN = "nngceckbapebfimnlniiiahkandclblb";

describe("chromeWebStoreExtensionId", () => {
  it.each([
    [BITWARDEN, BITWARDEN],
    [` ${BITWARDEN} `, BITWARDEN],
    [`https://chromewebstore.google.com/detail/bitwarden-password-manager/${BITWARDEN}`, BITWARDEN],
    [`https://chromewebstore.google.com/detail/${BITWARDEN}?hl=en`, BITWARDEN],
    [`https://chrome.google.com/webstore/detail/bitwarden/${BITWARDEN}`, BITWARDEN],
    ["https://chromewebstore.google.com/", null],
    ["https://chromewebstore.google.com/category/extensions", null],
    [`https://example.com/detail/x/${BITWARDEN}`, null],
    [`http://chromewebstore.google.com/detail/x/${BITWARDEN}`, null],
    ["nngceckbapebfimnlniiiahkandclblz", null],
  ])("reads %s", (source, expected) => {
    expect(chromeWebStoreExtensionId(source)).toBe(expected);
  });
});
