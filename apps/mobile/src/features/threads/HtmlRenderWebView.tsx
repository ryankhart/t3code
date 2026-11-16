import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { useNavigation } from "@react-navigation/native";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  HTML_RENDER_MAX_FIT_HEIGHT,
  HTML_RENDER_NATIVE_OPEN_IMAGE_SCRIPT,
  htmlRenderFileName,
  htmlRenderFrameHeight,
  htmlRenderThemeFragment,
  htmlRenderThemeMessage,
  readHtmlRenderImageRequest,
  type HtmlRenderReference,
  type HtmlRenderTheme,
} from "@t3tools/shared/htmlRender";
import { T, useGT } from "gt-react-native";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Platform,
  Pressable,
  View,
  type ColorValue,
  type GestureResponderEvent,
  type ViewInstance,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { SymbolView } from "../../components/ui/AppSymbol";
import { FilePreviewModal, type FilePreviewSource } from "../../components/ui/FilePreviewModal";
import { AppText as Text } from "../../components/ui/AppText";
import { mobileHtmlRenderTheme } from "../../lib/htmlRenderTheme";
import { useOpenPullRequest } from "../../native/useOpenPullRequest";
import { scopedThreadKey } from "../../lib/scopedEntities";
import {
  BALLOT_TAP_WINDOW_MS,
  type BallotTouchPoint,
  isBallotTap,
  createBallotToken,
  createBallotTapGate,
  ballotScript,
  readBallotMessage,
  requestBallotPicks,
} from "./ballot";
import { useAssetUrlState, useRefreshAssetUrl } from "../../state/assets";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { webViewDecelerationRate } from "../../lib/webViewDecelerationRate";
import { tryCopyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import {
  HTML_RENDER_CLIPBOARD_SCRIPT,
  htmlRenderClipboardReply,
  readHtmlRenderClipboardMessage,
} from "./htmlRenderClipboard";

const ROW_BOTTOM_MARGIN = 8;
const ACTION_ROW_HEIGHT = 32;
const FULL_SCREEN_GUTTER = 16;

export function htmlRenderRowHeight(frameHeight: number) {
  return ACTION_ROW_HEIGHT + frameHeight + ROW_BOTTOM_MARGIN;
}

function useHtmlRenderTheme() {
  const { themeId, themeAppearance, themeVariables, systemColorsActive } =
    useAppearancePreferences();
  return mobileHtmlRenderTheme({
    themeId,
    appearance: themeAppearance,
    variables: themeVariables,
    systemColors: systemColorsActive,
    platform: Platform.OS,
  });
}

function postTheme(view: WebView<object> | null, theme: HtmlRenderTheme) {
  view?.injectJavaScript(
    `window.postMessage(${JSON.stringify(htmlRenderThemeMessage(theme))}, "*"); true;`,
  );
}

const OVERFLOW_MESSAGE_TYPE = "t3-html-render-overflow";

const FIELD_FOCUS_MESSAGE_TYPE = "t3-html-render-field-focus";

// Also reports the document's height (as the desktop bootstrap measures it) so the frame can fit
// it, and the focused text field's rect, re-read on request since the page may move it, so the
// thread can lift it above the keyboard, which doesn't resize the page.
const FIELD_REPORT_FUNCTION = "__t3HtmlRenderReportField";
// An animating page resizes every frame; reporting once it settles keeps feed updates to one,
// and a page that never settles still reports every HEIGHT_SETTLE_MAX_MS.
const HEIGHT_SETTLE_MS = 80;
const HEIGHT_SETTLE_MAX_MS = 250;
const OVERFLOW_SCRIPT = `(function(){var last;function post(m){window.ReactNativeWebView.postMessage(JSON.stringify(m));}function report(){var d=document.documentElement,b=document.body;var x=Math.max(d.scrollWidth,b?b.scrollWidth:0)>window.innerWidth+1,y=Math.max(d.scrollHeight,b?b.scrollHeight:0)>window.innerHeight+1,h=Math.ceil(d.scrollHeight>d.clientHeight?d.scrollHeight:d.getBoundingClientRect().height),o=x+","+y+","+h+","+window.innerWidth;if(o===last)return;last=o;post({type:${JSON.stringify(OVERFLOW_MESSAGE_TYPE)},x:x,y:y,h:h});}var timer,first=0;function flush(){first=0;report();}function settle(){clearTimeout(timer);var now=Date.now();if(!first)first=now;if(now-first>=${HEIGHT_SETTLE_MAX_MS}){flush();return;}timer=setTimeout(flush,${HEIGHT_SETTLE_MS});}report();if(window.ResizeObserver){var r=new ResizeObserver(settle);r.observe(document.documentElement);if(document.body)r.observe(document.body);}window.addEventListener("resize",settle);window.addEventListener("load",report);function isField(t){return !!t&&(t.isContentEditable||t.tagName==="TEXTAREA"||t.tagName==="INPUT"&&/^(text|search|email|url|tel|number|password)$/.test(t.type));}window.${FIELD_REPORT_FUNCTION}=function(reply){var t=document.activeElement;if(!isField(t)||!document.hasFocus()){post({type:${JSON.stringify(FIELD_FOCUS_MESSAGE_TYPE)},blur:true,reply:reply});return;}var f=t.getBoundingClientRect();post({type:${JSON.stringify(FIELD_FOCUS_MESSAGE_TYPE)},top:f.top,bottom:f.bottom,reply:reply});};document.addEventListener("focusin",function(e){if(isField(e.target))window.${FIELD_REPORT_FUNCTION}(false);},true);document.addEventListener("click",function(e){if(isField(e.target)&&e.target===document.activeElement)window.${FIELD_REPORT_FUNCTION}(false);},true);document.addEventListener("focusout",function(){post({type:${JSON.stringify(FIELD_FOCUS_MESSAGE_TYPE)},blur:true,reply:false});},true);})();true;`;

type Overflow = { readonly x: boolean; readonly y: boolean };

const NO_OVERFLOW: Overflow = { x: false, y: false };

type OverflowReport = Overflow & { readonly height: number | undefined };

function readOverflowMessage(message: unknown): OverflowReport | null {
  return typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === OVERFLOW_MESSAGE_TYPE &&
    "x" in message &&
    typeof message.x === "boolean" &&
    "y" in message &&
    typeof message.y === "boolean"
    ? {
        x: message.x,
        y: message.y,
        height:
          "h" in message &&
          typeof message.h === "number" &&
          Number.isFinite(message.h) &&
          message.h > 0
            ? message.h
            : undefined,
      }
    : null;
}

function parseMessage(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function imagePreviewSource(message: unknown): FilePreviewSource | null {
  const request = readHtmlRenderImageRequest(message);
  if (request === undefined) return null;
  const gallery = request.images.map((image) => ({
    kind: "image" as const,
    uri: image.src,
    name: image.name,
  }));
  const selected = gallery[request.index];
  return selected ? { ...selected, gallery } : null;
}

type FieldFocusMessage = {
  /** True when answering the feed's request to re-read the field, false for a focus change. */
  readonly reply: boolean;
} & ({ readonly blur: true } | { readonly top: number; readonly bottom: number });

function readFieldFocusMessage(data: string): FieldFocusMessage | null {
  try {
    const message: unknown = JSON.parse(data);
    if (
      typeof message !== "object" ||
      message === null ||
      !("type" in message) ||
      message.type !== FIELD_FOCUS_MESSAGE_TYPE
    ) {
      return null;
    }
    const reply = "reply" in message && message.reply === true;
    if ("blur" in message && message.blur === true) return { reply, blur: true };
    return "top" in message &&
      typeof message.top === "number" &&
      Number.isFinite(message.top) &&
      "bottom" in message &&
      typeof message.bottom === "number" &&
      Number.isFinite(message.bottom)
      ? { reply, top: message.top, bottom: message.bottom }
      : null;
  } catch {
    return null;
  }
}

/** Where the focused field in a nested page is now, in window coordinates; null once it blurs. */
export type HtmlRenderFieldMeasure = () => Promise<{
  readonly top: number;
  readonly bottom: number;
} | null>;

const withoutFragment = (url: string) => url.split("#", 1)[0];

// Live frame heights (the page's height, fitted) by attachment and frame width. The feed sizes rows before they mount, and a
// row that mounts again (scrolled back into view) must not shrink to the server's guess and regrow.
// The feed gives these rows fixed sizes, which it never re-measures, so it re-renders on a change.
const liveHeights = new Map<string, number>();
const liveHeightListeners = new Set<() => void>();
const liveHeightKey = (attachmentId: string, width: number) =>
  `${attachmentId}:${Math.round(width)}`;

export function htmlRenderLiveHeight(attachmentId: string, width: number): number | undefined {
  return liveHeights.get(liveHeightKey(attachmentId, width));
}

export function subscribeHtmlRenderLiveHeights(listener: () => void): () => void {
  liveHeightListeners.add(listener);
  return () => {
    liveHeightListeners.delete(listener);
  };
}

function setHtmlRenderLiveHeight(attachmentId: string, width: number, height: number) {
  const key = liveHeightKey(attachmentId, width);
  if (liveHeights.get(key) === height) return;
  liveHeights.set(key, height);
  for (const listener of liveHeightListeners) listener();
}

export function HtmlRenderWebView(props: {
  readonly uri: string;
  readonly title: string;
  readonly nested: boolean;
  readonly onLoadError?: () => void;
  /** `afterTap` is true when the reader touched the page just before it resized. */
  readonly onContentHeight?: (height: number, afterTap: boolean) => void;
  /** A focused text field's position, or null when it loses focus. */
  readonly onFieldFocus?: (measure: HtmlRenderFieldMeasure | null) => void;
  /** Custom build: picks a ballot's `t3Compose(text)` hands to the message box after a tap. */
  readonly onBallotPicks?: (text: string) => void;
}) {
  const theme = useHtmlRenderTheme();
  const openLink = useOpenPullRequest();
  // Only a ballot view needs a token; whether it is one is fixed by its call site.
  const [ballotToken] = useState(() =>
    props.onBallotPicks === undefined ? null : createBallotToken(),
  );
  const [tapGate] = useState(createBallotTapGate);
  const isBallot = ballotToken !== null && props.onBallotPicks !== undefined;
  const touchPoint = (event: GestureResponderEvent) => ({
    x: event.nativeEvent.pageX,
    y: event.nativeEvent.pageY,
    at: Date.now(),
  });
  const handOverPicks = (texts: readonly string[]) => {
    for (const text of texts) props.onBallotPicks?.(text);
  };
  const [initialTheme] = useState(theme);
  const [generation, setGeneration] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [overflow, setOverflow] = useState(NO_OVERFLOW);
  const [preview, setPreview] = useState<FilePreviewSource | null>(null);
  const webView = useRef<WebView<object>>(null);
  const frame = useRef<ViewInstance>(null);
  const touchStart = useRef<BallotTouchPoint | null>(null);
  const lastTouchAt = useRef<number | null>(null);
  const pendingField = useRef<((field: { top: number; bottom: number } | null) => void) | null>(
    null,
  );
  const crashes = useRef(0);
  const shownTheme = useRef<HtmlRenderTheme | null>(null);
  const source = { uri: props.uri + htmlRenderThemeFragment(initialTheme) };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- posts theme changes into the already loaded WebView
  useEffect(() => {
    if (shownTheme.current === null || shownTheme.current === theme) return;
    shownTheme.current = theme;
    postTheme(webView.current, theme);
  }, [theme]);
  const restart = () => {
    crashes.current += 1;
    if (crashes.current > 1) {
      props.onLoadError?.();
      return;
    }
    shownTheme.current = null;
    pendingField.current?.(null);
    pendingField.current = null;
    setLoaded(false);
    setOverflow(NO_OVERFLOW);
    setGeneration((value) => value + 1);
  };
  const scrollable = !props.nested || overflow.x || overflow.y;
  return (
    <View
      ref={frame}
      // Raw touches reach this wrapper even when the web view handles them. A page may only fill
      // the message box just after a tap (a touch that barely moved), not on load, on its own
      // timer or during a scroll.
      onTouchStart={(event) => {
        touchStart.current = touchPoint(event);
        if (isBallot) tapGate.touchStart(touchStart.current);
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        const end = touchPoint(event);
        if (start !== null && isBallotTap(start, end)) lastTouchAt.current = end.at;
        if (isBallot) handOverPicks(tapGate.touchEnd(end));
      }}
      onTouchCancel={isBallot ? () => tapGate.touchCancel() : undefined}
      style={
        props.nested
          ? { flex: 1 }
          : {
              flex: 1,
              paddingHorizontal: FULL_SCREEN_GUTTER,
              backgroundColor: theme.variables["--background"],
            }
      }
    >
      <WebView<object>
        key={generation}
        ref={webView}
        source={source}
        accessibilityLabel={props.title}
        style={{ flex: 1, backgroundColor: "transparent" }}
        allowsInlineMediaPlayback
        contentInsetAdjustmentBehavior={props.nested ? "never" : "automatic"}
        bounces={!props.nested}
        showsVerticalScrollIndicator={!props.nested}
        showsHorizontalScrollIndicator={!props.nested}
        scrollEnabled={scrollable}
        decelerationRate={webViewDecelerationRate}
        // Android's patched WebView always keeps horizontal drags. Only pages
        // too tall for the frame to fit hold vertical drags until they reach an edge.
        nestedScrollEnabled={props.nested && overflow.y}
        overScrollMode={props.nested ? "never" : "always"}
        onShouldStartLoadWithRequest={(request) =>
          request.isTopFrame === false ||
          withoutFragment(request.url) === withoutFragment(props.uri)
        }
        onOpenWindow={(event) => {
          const url = event.nativeEvent.targetUrl;
          if (/^https?:/i.test(url)) void openLink(url);
        }}
        onLoadEnd={() => {
          setLoaded(true);
          shownTheme.current = theme;
          if (theme !== initialTheme) postTheme(webView.current, theme);
        }}
        onError={props.onLoadError}
        onHttpError={props.onLoadError}
        onContentProcessDidTerminate={restart}
        onRenderProcessGone={restart}
        injectedJavaScript={
          props.nested
            ? OVERFLOW_SCRIPT + HTML_RENDER_NATIVE_OPEN_IMAGE_SCRIPT
            : HTML_RENDER_NATIVE_OPEN_IMAGE_SCRIPT
        }
        injectedJavaScriptBeforeContentLoaded={
          isBallot
            ? ballotScript(ballotToken) + HTML_RENDER_CLIPBOARD_SCRIPT
            : HTML_RENDER_CLIPBOARD_SCRIPT
        }
        onMessage={(event: WebViewMessageEvent) => {
          const copy = readHtmlRenderClipboardMessage(event.nativeEvent.data);
          if (copy !== null) {
            const view = webView.current;
            void tryCopyTextWithHaptic(copy.text, { target: "page text" }).then((ok) =>
              view?.injectJavaScript(htmlRenderClipboardReply(copy.id, ok)),
            );
            return;
          }
          const message = parseMessage(event.nativeEvent.data);
          const image = imagePreviewSource(message);
          if (image !== null) {
            setPreview(image);
            return;
          }
          const next = props.nested ? readOverflowMessage(message) : null;
          if (next !== null) {
            // The frame grows to fit a page up to the cap, so only a taller page scrolls inside
            // it. Counting a page that is about to be fitted would hold the reader's next drag.
            const y = next.y && (next.height ?? Infinity) > HTML_RENDER_MAX_FIT_HEIGHT;
            setOverflow((current) =>
              current.x === next.x && current.y === y ? current : { x: next.x, y },
            );
            if (next.height !== undefined) {
              const touchedAt = lastTouchAt.current;
              props.onContentHeight?.(
                next.height,
                touchedAt !== null && Date.now() - touchedAt <= BALLOT_TAP_WINDOW_MS,
              );
            }
            return;
          }
          const field = props.nested ? readFieldFocusMessage(event.nativeEvent.data) : null;
          if (field !== null) {
            const pending = pendingField.current;
            if (field.reply || "blur" in field) pendingField.current = null;
            if ("blur" in field) {
              pending?.(null);
              if (!field.reply) props.onFieldFocus?.(null);
            } else if (field.reply) {
              const view = frame.current;
              if (!view) pending?.(null);
              else {
                view.measureInWindow((_x, y) =>
                  pending?.({ top: y + field.top, bottom: y + field.bottom }),
                );
              }
            } else {
              props.onFieldFocus?.(
                () =>
                  new Promise((resolve) => {
                    pendingField.current?.(null);
                    pendingField.current = resolve;
                    webView.current?.injectJavaScript(
                      `window.${FIELD_REPORT_FUNCTION}&&window.${FIELD_REPORT_FUNCTION}(true);true;`,
                    );
                  }),
              );
            }
            return;
          }
          const request = isBallot
            ? readBallotMessage(event.nativeEvent.data, ballotToken)
            : undefined;
          if (request !== undefined) handOverPicks(tapGate.request(request.text, Date.now()));
        }}
      />
      <FilePreviewModal source={preview} onRequestClose={() => setPreview(null)} />
      {loaded ? null : (
        <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
          <AppActivityIndicator />
        </View>
      )}
    </View>
  );
}

export function ThreadHtmlRender(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly render: HtmlRenderReference;
  readonly frameWidth: number;
  readonly iconColor: ColorValue;
  /** Called with the old row height just before the reader's tap resizes the frame. */
  readonly onResize?: (previousRowHeight: number) => void;
  readonly onFieldFocus?: (measure: HtmlRenderFieldMeasure | null) => void;
}) {
  const gt = useGT();
  const navigation = useNavigation();
  const { attachmentId, title } = props.render;
  const liveHeight = useSyncExternalStore(subscribeHtmlRenderLiveHeights, () =>
    htmlRenderLiveHeight(attachmentId, props.frameWidth),
  );
  const height = liveHeight ?? htmlRenderFrameHeight(props.render, props.frameWidth);
  const handleContentHeight = (contentHeight: number, afterTap: boolean) => {
    // Storing the fitted height drops changes the frame can't show (past the cap or under the floor).
    const next = htmlRenderFrameHeight(props.render, props.frameWidth, contentHeight);
    if (next === height) return;
    if (afterTap) props.onResize?.(htmlRenderRowHeight(height));
    setHtmlRenderLiveHeight(attachmentId, props.frameWidth, next);
  };
  const fileName = htmlRenderFileName(title);
  const resource = {
    _tag: "attachment" as const,
    attachmentId,
    fileName,
    mimeType: "text/html",
    disposition: "inline" as const,
  };
  const asset = useAssetUrlState(props.environmentId, resource);
  const refresh = useRefreshAssetUrl(props.environmentId, resource);
  // Signed URLs are re-minted periodically; following them would reload the page.
  const [uri, setUri] = useState<string | null>(null);
  if (uri === null && asset._tag === "Success") setUri(asset.url);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retried = useRef(false);
  const handleLoadError = () => {
    if (retried.current) {
      setFailed(true);
      return;
    }
    retried.current = true;
    void refresh().then((next) => {
      if (next === null) setFailed(true);
      else if (next !== uri) setUri(next);
      else setAttempt((value) => value + 1);
    });
  };

  return (
    <View style={{ marginBottom: ROW_BOTTOM_MARGIN }}>
      <View style={{ height: ACTION_ROW_HEIGHT }} className="flex-row items-start justify-end">
        {uri !== null && !failed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={gt("Open {title}", { title })}
            hitSlop={8}
            className="h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-card/80"
            onPress={() =>
              navigation.navigate("ThreadAttachment", {
                environmentId: String(props.environmentId),
                threadId: String(props.threadId),
                attachmentId,
                name: fileName,
                mimeType: "text/html",
                sizeBytes: "0",
                htmlRender: "1",
              })
            }
          >
            <SymbolView
              name="arrow.up.left.and.arrow.down.right"
              size={12}
              tintColor={props.iconColor}
              type="monochrome"
            />
          </Pressable>
        ) : null}
      </View>
      <View style={{ height }}>
        {uri !== null && !failed ? (
          <HtmlRenderWebView
            key={`${uri}:${attempt}`}
            uri={uri}
            title={title}
            nested
            onLoadError={handleLoadError}
            onContentHeight={handleContentHeight}
            {...(props.onFieldFocus ? { onFieldFocus: props.onFieldFocus } : {})}
            onBallotPicks={(text) =>
              requestBallotPicks({
                threadKey: scopedThreadKey(props.environmentId, props.threadId),
                text,
              })
            }
          />
        ) : failed || asset._tag === "Failure" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={gt("Reload {title}", { title })}
            className="flex-1 items-center justify-center"
            onPress={() => {
              retried.current = false;
              setFailed(false);
              if (uri === null) void refresh().then((next) => next !== null && setUri(next));
            }}
          >
            <Text className="text-sm text-foreground-muted">
              <T>Page unavailable</T>
            </Text>
          </Pressable>
        ) : (
          <View className="flex-1 items-center justify-center">
            <AppActivityIndicator />
          </View>
        )}
      </View>
    </View>
  );
}
