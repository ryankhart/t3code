// Custom build: html_render pages load over plain http (LAN or Tailscale), where the web view has no
// `navigator.clipboard`, so a page's copy button always failed on the phone. This shim hands the
// text to the app, which writes the system clipboard and answers the page's promise.

const MESSAGE_TYPE = "t3-html-render-clipboard";
const DONE_FUNCTION = "__t3HtmlRenderClipboardDone";

/**
 * Injected before content loads. Like the browser's own clipboard, it needs a recent tap when the
 * web view reports user activation.
 */
export const HTML_RENDER_CLIPBOARD_SCRIPT = `(function(){var r=window.ReactNativeWebView;if(!r||typeof r.postMessage!=="function")return;var p=r.postMessage.bind(r),u=navigator.userActivation,g=null;try{var d=u&&Object.getOwnPropertyDescriptor(Object.getPrototypeOf(u),"isActive");if(d&&typeof d.get==="function")g=d.get;}catch(e){}var n=0,w={};function f(m){return typeof DOMException==="function"?new DOMException(m,"NotAllowedError"):new Error(m);}function t(x){return new Promise(function(res,rej){if(g&&g.call(u)!==true){rej(f("Copying needs a tap"));return;}var i=++n;w[i]=[res,rej];p(JSON.stringify({type:${JSON.stringify(MESSAGE_TYPE)},id:i,text:String(x)}));});}function c(items){var it=items&&items[0];if(!it||typeof it.getType!=="function")return Promise.reject(f("Nothing to copy"));return Promise.resolve(it.getType("text/plain")).then(function(b){return typeof b==="string"?b:b.text();}).then(t);}var clip={writeText:t,write:c};try{Object.defineProperty(navigator,"clipboard",{configurable:true,get:function(){return clip;}});}catch(e){}window[${JSON.stringify(DONE_FUNCTION)}]=function(i,ok){var h=w[i];if(!h)return;delete w[i];if(ok)h[0]();else h[1](f("Copy failed"));};})();true;`;

/** A copy request from the shim, or null for any other message. */
export function readHtmlRenderClipboardMessage(
  data: string,
): { readonly id: number; readonly text: string } | null {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof message !== "object" || message === null) return null;
  const { type, id, text } = message as Record<string, unknown>;
  return type === MESSAGE_TYPE &&
    typeof id === "number" &&
    Number.isInteger(id) &&
    typeof text === "string"
    ? { id, text }
    : null;
}

/** Script that settles the page's promise for request `id`. */
export function htmlRenderClipboardReply(id: number, ok: boolean): string {
  return `window.${DONE_FUNCTION}&&window.${DONE_FUNCTION}(${id},${ok});true;`;
}
