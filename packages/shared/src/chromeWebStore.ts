const EXTENSION_ID = /^[a-p]{32}$/;
const WEB_STORE_HOSTS = new Set(["chromewebstore.google.com", "chrome.google.com"]);

/** The extension ID in a Chrome Web Store detail-page URL, or a bare ID. */
export function chromeWebStoreExtensionId(source: string): string | null {
  const trimmed = source.trim();
  if (EXTENSION_ID.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !WEB_STORE_HOSTS.has(url.hostname)) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const detail = segments.indexOf("detail");
  if (detail === -1) return null;
  return segments.slice(detail + 1).find((segment) => EXTENSION_ID.test(segment)) ?? null;
}
