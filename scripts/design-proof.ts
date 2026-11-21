// Proof that the E3 and E4 designs meet their requirements and the design system.
//
// The design review is a loop: requirement, design, proof, review, then a
// correction to the requirement or to the design. This script is the proof
// step. It reads the live HTML of each frame on the two Doop canvases and
// checks it against docs/epics.md and against the library's components and
// tokens. The canvases and their pages: docs/design-canvas.md.
//
// Scope: the E3 and E4 frames on the product canvas (always), each frame on a system
// page of the library canvas (always), and each other frame on either canvas
// that asks for sign-off (ready_for_dev or needs_review).
// A draft is an exploration: it may break the rules until it asks for review.
//
// Usage: bun scripts/design-proof.ts
// Key: DOOP_KEY, or the file ~/.config/secrets/doop-agent-key.
//
// One finding is one line: `<frame> <rule id> <what is there>`.
// Rules:
//   R1 each E3 and E4 ID shows on a state of a sheet, or is in NOT_SHOWN with a reason.
//   R2 each ID on a sheet is an ID of the sheet's epic in docs/epics.md.
//   R3 F1: each state of F1 shows on a sheet, and each has its own look.
//   R4 F2: each full screen shows the count.
//   R5 N4: each open request and each row shows its reference.
//   R6 N10: a Composer in the error state shows why and keeps the text.
//   S1 no raw colour outside the tokens.
//   S2 type and shape use the tokens.
//   S3 nothing redraws a component: no native control outside one.
//   S4 a frame does not restyle a class of a component.
//   S5 all instances of a component are at one revision.
//   S6 at most one primary Button in a Popover.
//   S7 each instance is a component of the system.
//   S8 spacing (padding, margin, gap) is a step of the scale: var(--e-N), 0 or auto.
//   S9 line height is a token pair of the type scale: var(--e-leading-N), 1 or normal.
//   S10 motion: transform and opacity only, 300ms at most, the ease-out curve,
//       hover only on a fine pointer, and a reduced-motion fallback.
//   S11 a shadow is one of three elevations, or a ring.
//   S12 a size is on the 4px grid.
//   S13 the product canvas has the library's tokens, with the same values.
//   S14 each text colour has WCAG AA contrast (4.5:1) on each surface, in light and dark (E3 S14).
//   T1 text: … not ..., curly quotes, a no-break space between a number and its unit.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// easel · Design system: the tokens and the component mains (the library).
const LIBRARY = "zPdfXgdRrQ";
// easel · Product design: the screens and sheets of each epic.
const PRODUCT = "xFJSTXA-v5";
const API = "https://doop.vibea.dev/api/frames";
const MCP = "https://doop.vibea.dev/mcp";

// screen, page and sheet: the design of an epic, checked in any status. A page is a full
// screen that is not the canvas (a gate, the ended page, the CLI): it has no count (R4).
// main: a frame on a system page (a component's main, or Foundations).
// ready: any other frame that asks for sign-off. A draft is free to explore.
type Kind = "screen" | "page" | "sheet" | "main" | "ready";

const E4: ReadonlyArray<{ id: string; kind: Kind }> = [
  { id: "h4pczpz7sn", kind: "screen" },
  { id: "A5Gv6NBxJU", kind: "screen" },
  { id: "xZxKRBPG59", kind: "screen" },
  { id: "xVgR-qmTi6", kind: "screen" },
  { id: "AWhtNkav_w", kind: "screen" },
  { id: "RHg6J4OJp3", kind: "screen" },
  { id: "czHEZgeUB1", kind: "sheet" },
  { id: "vfw3zMtZR4", kind: "sheet" },
  { id: "snNDeRWYP3", kind: "sheet" },
  { id: "nc_QkyELZE", kind: "sheet" },
  { id: "tIYPbqSQkj", kind: "screen" },
  { id: "7PFY_lefFv", kind: "screen" },
  { id: "jPg3fYFw8R", kind: "screen" },
  { id: "Y_94t0smk6", kind: "screen" },
  { id: "tf3-PO3uCH", kind: "screen" },
  { id: "tV-Ko4AjFL", kind: "screen" },
  { id: "1md0B8cdTb", kind: "screen" },
  { id: "7zyVq308w8", kind: "screen" },
  { id: "zbNPXgvOW-", kind: "screen" },
  { id: "OQZFSPFTui", kind: "screen" },
  { id: "sS3Ix9Y5vs", kind: "screen" },
  { id: "S4gcCpF73f", kind: "screen" },
  { id: "Mzqv7HAKR8", kind: "screen" },
  { id: "pBOtrmvs4W", kind: "screen" },
  { id: "rTAw-XG1pV", kind: "screen" },
  { id: "aE2GhLnZ8x", kind: "screen" },
  { id: "0OkmCW7OTg", kind: "screen" },
  { id: "RR-ctugYtw", kind: "screen" },
  { id: "dFdmACrCPG", kind: "screen" },
  { id: "TK-RtepvlT", kind: "screen" },
  { id: "l2D2FqgLFN", kind: "screen" },
  { id: "pAaVNuVTKy", kind: "screen" },
  { id: "r1vkBzmXNV", kind: "screen" },
  { id: "ySB315qncO", kind: "screen" },
  { id: "nqNh5qABon", kind: "screen" },
  { id: "7WI3TZNtD3", kind: "screen" },
  { id: "HxBtW0AHEq", kind: "screen" },
  { id: "ks9bzBk8Ut", kind: "screen" },
  { id: "Utx1i4WktI", kind: "screen" },
  { id: "88Ax6X-gQO", kind: "screen" },
  { id: "NLclOIm3ni", kind: "screen" },
  { id: "Z7AnSVnDlr", kind: "screen" },
  { id: "WDhJwEN8xL", kind: "screen" },
  { id: "CM3vB_SZp2", kind: "screen" },
  { id: "dZIcF14b_K", kind: "screen" },
  { id: "z-6nielbSo", kind: "screen" },
  { id: "nBkSw9ApCe", kind: "screen" },
  { id: "4_WvadZ-ZE", kind: "screen" },
  { id: "q7tIF9WFmx", kind: "screen" },
  { id: "TH2sKAN3Nj", kind: "screen" },
  { id: "t20k2oDI-R", kind: "screen" },
  { id: "JXZ7jpq-sd", kind: "screen" },
  { id: "BLQBCn2xPM", kind: "screen" },
  { id: "c3xVyfPx-7", kind: "screen" },
  { id: "O0OPorV-n6", kind: "screen" },
  { id: "Ut3zYCeY3v", kind: "screen" },
  { id: "u9nZm8jKuD", kind: "screen" },
  { id: "AhuGpdJlUf", kind: "screen" },
  { id: "5TBFxBzFCB", kind: "screen" },
  { id: "Q84YFf2dBZ", kind: "screen" },
];

// The E3 design: page `Work · E3 Share and look`.
const E3: ReadonlyArray<{ id: string; kind: Kind }> = [
  { id: "t1khXPEL09", kind: "sheet" },
  { id: "-Ck-zZRXd-", kind: "page" },
  { id: "Iy-yjtexBr", kind: "page" },
  { id: "sCPZfGyx4f", kind: "page" },
  { id: "bGzmRU6QGr", kind: "page" },
  { id: "MF5lt4IJuW", kind: "page" },
  { id: "Bt6ELgTB-h", kind: "screen" },
  { id: "C37B_BYpYM", kind: "screen" },
  { id: "UEKzhvtyYt", kind: "page" },
  { id: "sPQSIcxr6o", kind: "screen" },
  { id: "L3QURfp8mv", kind: "page" },
  { id: "sHgPqffmWn", kind: "screen" },
  { id: "6_MTPksuJG", kind: "sheet" },
  { id: "xpeMsam50t", kind: "page" },
  { id: "U-GpX2Ahvg", kind: "screen" },
  { id: "rq2XCe9U5r", kind: "screen" },
  { id: "VxKFjgLy3w", kind: "screen" },
  { id: "XQpw70VuH-", kind: "screen" },
  { id: "-SQRkwRPgf", kind: "screen" },
  { id: "dRXlfnNKR3", kind: "page" },
  { id: "k57fxBGG06", kind: "screen" },
  { id: "snGUZR-mMv", kind: "screen" },
  // A canvas with no frames has no requests, so no count (F2: none at 0).
  { id: "lY0qbt9UOG", kind: "page" },
  { id: "1JwTBweA0t", kind: "screen" },
  { id: "bubjKGKm3E", kind: "screen" },
  { id: "2IGMQX4YlS", kind: "screen" },
  { id: "mCNt_6ka2d", kind: "screen" },
  { id: "j-WeeGzI9M", kind: "screen" },
  { id: "pz6YsbPa7n", kind: "screen" },
];

const EPICS: ReadonlyArray<{ epic: string; frames: ReadonlyArray<{ id: string; kind: Kind }> }> = [
  { epic: "E3", frames: E3 },
  { epic: "E4", frames: E4 },
];

const DESIGN: Array<Frame> = EPICS.flatMap((e) => e.frames.map((f) => ({ ...f, epic: e.epic })));

// Each frame on these pages of the library is part of the system: always checked.
const SYSTEM_PAGES = new Set(["1 · Foundations", "2 · Primitives", "3 · Patterns", "4 · Layout"]);

// A frame in one of these states must use the system (S1 to S12, T1).
const READY = new Set(["ready_for_dev", "needs_review"]);

const COMPONENTS: Readonly<Record<string, string>> = {
  cywze40i6e: "Button",
  cw8rv3bcji: "Count",
  chn7831wg0: "StateBadge",
  cekbk01slm: "Pin",
  cybbmb2ok4: "Status",
  cwm37u9iup: "Card",
  c5qegs2cae: "Toolbar",
  csejl0me3t: "Sidebar",
  ccf1ytif73: "RequestRow",
  ch77o3b8oo: "Message",
  ct7d5vt4a1: "Composer",
  cv40o7w4k4: "Popover",
  ci5o10ns3o: "Event",
  c7wmro5991: "ThreadHead",
  c3ol8whkki: "MenuItem",
  cjvyvxy96f: "Menu",
  c831u1xba4: "Compare",
  chbrui0hwl: "StateNote",
  c1pbm9m4kc: "TextField",
  c3r5gzysea: "Checkbox",
  c7ohgps6yk: "SegmentedItem",
  c6r6di27zy: "Segmented",
  cz98spnfrz: "Tab",
  cnmb1u4ho3: "Tabs",
  cqzfqjd44d: "Chip",
  c5e4pv7vgx: "Avatar",
  clqhupjdan: "Toast",
  cjblw4001k: "Dialog",
  cnt8xhu7ot: "EmptyState",
  clbzalz58t: "Dock",
};

// IDs that no picture can prove. Each one is proven elsewhere.
const NOT_SHOWN: Readonly<Record<string, string>> = {
  M1: "order of the queue: SPEC-queue, queue-lease chart",
  M3: "what an agent gets: SPEC-queue, SPEC-mcp",
  M4: "lease ends: SPEC-queue, queue-lease chart",
  M5: "an agent that needs more time keeps the request: SPEC-queue, queue-lease chart",
  M6: "a release: SPEC-queue; the viewer sees the request waiting again",
  M7: "agent wait time: SPEC-queue",
  M8: "scope of a change: SPEC-queue, SPEC-mcp",
  N7: "a pin moves with its frame: SPEC-viewer",
  F4: "time to show: SPEC-viewer live board",
  // E4.5: the dispatcher has no screen. The team lead uses the CLI and GitHub.
  D1: "one queue: SPEC-queue, queue-lease chart",
  D2: "an agent that asks gets work: SPEC-queue (M7)",
  D6: "a delivery starts an agent: SPEC-queue, queue-dispatch chart",
  D7: "the team lead sets channels: SPEC-queue, easel channel set",
  D8: "one outcome for each request: queue-dispatch chart",
  D9: "the way and its cause: SPEC-queue, easel deliveries",
  D10: "GitHub issues follow requests: SPEC-queue, queue-dispatch chart",
  // E3: a picture shows the state, not how fast it comes.
  S11: "200 frames stay smooth: tests/browser/viewer-canvas.test.tsx (p95 handler time)",
};

// F1 states and the StateBadge state that shows each.
const F1_STATES = [
  "waiting",
  "inwork",
  "question",
  "result",
  "done",
  "person",
  "outdated",
  "closed",
] as const;

const CARD = "cwm37u9iup";
const COUNT = "cw8rv3bcji";
const BADGE = "chn7831wg0";

type Frame = { id: string; kind: Kind; epic?: string };

type Instance = {
  frame: string;
  comp: string;
  rev: string;
  props: Record<string, string>;
  text: string;
  parent: Instance | undefined;
  // The main of a component (data-doop-component), not an instance of it.
  main: boolean;
};

type Css = { owner: string; css: string };

type Parsed = {
  instances: Array<Instance>;
  css: Array<Css>;
  natives: Array<string>;
  // The copy a viewer reads: text nodes and text attributes, one per line.
  copy: string;
};

type Finding = { frame: string; rule: string; what: string };

const findings: Array<Finding> = [];

const report = (frame: string, rule: string, what: string): void => {
  findings.push({ frame, rule, what });
};

const readKey = async (): Promise<string> => {
  const fromEnv = process.env.DOOP_KEY;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;

  const file = Bun.file(`${process.env.HOME ?? ""}/.config/secrets/doop-agent-key`);
  return (await file.text()).trim();
};

// HTMLRewriter gives attribute values with their entities.
const decode = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const parseProps = (raw: string | null): Record<string, string> => {
  const out: Record<string, string> = {};
  if (raw === null) return out;

  const value: unknown = JSON.parse(decode(raw));
  if (typeof value !== "object" || value === null) return out;

  for (const [k, v] of Object.entries(value)) if (typeof v === "string") out[k] = v;
  return out;
};

// --- Read one frame -------------------------------------------------------

type Open = {
  inst: Instance | undefined;
  sample: boolean;
  // Inside <style> or <script>: its text is code, not copy.
  raw: boolean;
  style: Css | undefined;
  prop: string | undefined;
};

type ReadState = { frame: string; stack: Array<Open>; parsed: Parsed };

const NATIVE = new Set(["button", "input", "textarea", "select"]);

// A sample design drawn inside a frame card, not product UI.
const SAMPLE_CLASSES = new Set(["pic", "gone"]);

const top = (s: ReadState): Open | undefined => s.stack[s.stack.length - 1];

const nearestInstance = (s: ReadState): Instance | undefined =>
  s.stack.findLast((o) => o.inst !== undefined)?.inst;

const newInstance = (s: ReadState, el: HTMLRewriterTypes.Element): Instance | undefined => {
  const instanceOf = el.getAttribute("data-doop-instance");
  const id = instanceOf ?? el.getAttribute("data-doop-component");
  if (id === null) return undefined;

  return {
    frame: s.frame,
    comp: id,
    rev: el.getAttribute("data-doop-rev") ?? "",
    props: parseProps(el.getAttribute("data-doop-props")),
    text: "",
    parent: nearestInstance(s),
    main: instanceOf === null,
  };
};

const isSample = (s: ReadState, el: HTMLRewriterTypes.Element): boolean => {
  if (top(s)?.sample === true) return true;

  const classes = (el.getAttribute("class") ?? "").split(/\s+/);
  if (classes.some((c) => SAMPLE_CLASSES.has(c))) return true;

  return nearestInstance(s)?.comp === CARD && el.getAttribute("data-doop-slot") === "body";
};

const noteNative = (
  s: ReadState,
  tag: string,
  own: Instance | undefined,
  sample: boolean,
): void => {
  if (!NATIVE.has(tag) || sample) return;
  if (own !== undefined || nearestInstance(s) !== undefined) return;

  s.parsed.natives.push(tag);
};

const noteInline = (s: ReadState, el: HTMLRewriterTypes.Element, sample: boolean): void => {
  const style = el.getAttribute("style");
  if (style === null || sample) return;

  s.parsed.css.push({ owner: "inline", css: `x{${style}}` });
};

const openStyle = (s: ReadState, el: HTMLRewriterTypes.Element, tag: string): Css | undefined => {
  if (tag !== "style" || el.hasAttribute("data-doop-tokens")) return undefined;

  // A main's own CSS (component-source) belongs to the component too.
  const owner =
    el.getAttribute("data-doop-component-css") ??
    el.getAttribute("data-doop-component-source") ??
    "frame";
  const block = { owner, css: "" };
  s.parsed.css.push(block);
  return block;
};

// A main has no data-doop-props: read each prop from its element.
const mainProp = (
  s: ReadState,
  el: HTMLRewriterTypes.Element,
  own: Instance | undefined,
): string | undefined => {
  const owner = own ?? nearestInstance(s);
  const prop = el.getAttribute("data-doop-prop");
  if (owner?.main !== true || prop === null) return undefined;

  return prop;
};

const onElement = (s: ReadState, el: HTMLRewriterTypes.Element): void => {
  const tag = el.tagName.toLowerCase();
  const inst = newInstance(s, el);
  if (inst !== undefined) s.parsed.instances.push(inst);

  const sample = isSample(s, el);
  noteNative(s, tag, inst, sample);
  noteInline(s, el, sample);
  noteCopyAttrs(s, el, sample);
  const style = openStyle(s, el, tag);
  if (el.selfClosing || !el.canHaveContent) return;

  const raw = tag === "style" || tag === "script";
  s.stack.push({ inst, sample, raw, style, prop: mainProp(s, el, inst) });
  el.onEndTag(() => {
    s.stack.pop();
  });
};

const addPropText = (s: ReadState, open: Open | undefined, text: string): void => {
  const inst = nearestInstance(s);
  if (open?.prop === undefined || inst === undefined) return;

  inst.props[open.prop] = (inst.props[open.prop] ?? "") + text;
};

const COPY_ATTRS = ["placeholder", "aria-label", "title", "alt"] as const;

const noteCopyAttrs = (s: ReadState, el: HTMLRewriterTypes.Element, sample: boolean): void => {
  if (sample) return;

  for (const a of COPY_ATTRS) {
    const v = el.getAttribute(a);
    if (v !== null) s.parsed.copy += `${decode(v)}\n`;
  }
};

const addCopy = (s: ReadState, open: Open | undefined, t: HTMLRewriterTypes.Text): void => {
  if (open?.raw === true || open?.sample === true) return;

  s.parsed.copy += decode(t.text);
  if (t.lastInTextNode) s.parsed.copy += "\n";
};

const onText = (s: ReadState, t: HTMLRewriterTypes.Text): void => {
  const open = top(s);
  if (open?.style !== undefined) {
    open.style.css += t.text;
    return;
  }

  addCopy(s, open, t);

  // A space ends each text node, so the text of two parts never joins ("first" "M20").
  const text = t.lastInTextNode ? `${t.text} ` : t.text;
  for (const o of s.stack) if (o.inst !== undefined) o.inst.text += text;
  addPropText(s, open, t.text);
};

const parseFrame = async (frame: string, html: string): Promise<Parsed> => {
  const s: ReadState = {
    frame,
    stack: [],
    parsed: { instances: [], css: [], natives: [], copy: "" },
  };
  const rewriter = new HTMLRewriter().on("*", {
    element: (el) => onElement(s, el),
    text: (t) => onText(s, t),
  });
  await rewriter.transform(new Response(html)).text();

  for (const i of s.parsed.instances) i.text = i.text.replace(/\s+/g, " ").trim();
  return s.parsed;
};

const loadFrame = async (f: Frame, key: string): Promise<Parsed | undefined> => {
  const res = await fetch(`${API}/${f.id}/html`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) {
    report(f.id, "IO", `GET ${res.status}`);
    return undefined;
  }

  return parseFrame(f.id, await res.text());
};

// --- Which frames: E4, the system pages, and frames that ask for sign-off --

type CanvasFrame = { canvas: string; id: string; page: string; status: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const field = (v: unknown, k: string): string => {
  if (!isRecord(v)) return "";
  const out = v[k];
  return typeof out === "string" ? out : "";
};

const listOf = (v: unknown, k: string): Array<unknown> => {
  if (!isRecord(v)) return [];
  const out: unknown = v[k];
  return Array.isArray(out) ? out : [];
};

// A token value is a string or a number; compare both as text.
const scalar = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";

// One token as one line: its type, its value, then its value in each theme.
const tokenLine = (t: unknown): string => {
  const themes = isRecord(t) ? t.themes : undefined;
  const byTheme = isRecord(themes)
    ? Object.entries(themes)
        .map(([k, v]) => `${k}=${scalar(v)}`)
        .sort()
        .join(" ")
    : "";
  return `${field(t, "type")} ${isRecord(t) ? scalar(t.value) : ""} ${byTheme}`.trim();
};

type Doop = {
  frames: Array<CanvasFrame>;
  tokens: { library: Map<string, string>; product: Map<string, string> };
};

const callTool = async (
  client: Client,
  name: string,
  args: Record<string, string>,
): Promise<unknown> => {
  const res = await client.callTool({ name, arguments: args });
  const parts = listOf(res, "content").map((c) => field(c, "text"));
  return JSON.parse(parts.join(""));
};

const framesOf = async (client: Client, canvas: string): Promise<Array<CanvasFrame>> => {
  const body = await callTool(client, "get_canvas", { canvas_id: canvas });
  const pages = new Map(listOf(body, "pages").map((p) => [field(p, "id"), field(p, "name")]));
  return listOf(body, "frames").map((f) => ({
    canvas,
    id: field(f, "id"),
    page: pages.get(field(f, "pageId")) ?? "",
    status: field(f, "approvalStatus"),
  }));
};

const tokensOf = async (client: Client, canvas: string): Promise<Map<string, string>> => {
  const body = await callTool(client, "get_tokens", { canvas_id: canvas, format: "json" });
  return new Map(listOf(body, "tokens").map((t) => [field(t, "name"), tokenLine(t)]));
};

// The HTTP API has no frame list for an agent key; the MCP get_canvas has.
const readDoop = async (key: string): Promise<Doop> => {
  const client = new Client({ name: "easel-design-proof", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP), {
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  });
  await client.connect(transport);

  try {
    const frames = [...(await framesOf(client, LIBRARY)), ...(await framesOf(client, PRODUCT))];
    const tokens = {
      library: await tokensOf(client, LIBRARY),
      product: await tokensOf(client, PRODUCT),
    };
    return { frames, tokens };
  } finally {
    await client.close();
  }
};

type Scope = { frames: Array<Frame>; ready: number; drafts: number };

const kindOf = (f: CanvasFrame): Kind | undefined => {
  if (f.canvas === LIBRARY && SYSTEM_PAGES.has(f.page)) return "main";
  return READY.has(f.status) ? "ready" : undefined;
};

const chooseFrames = (canvas: Array<CanvasFrame>): Scope => {
  const scope: Scope = { frames: [], ready: 0, drafts: 0 };
  const onProduct = new Set(canvas.filter((f) => f.canvas === PRODUCT).map((f) => f.id));
  for (const f of DESIGN) {
    if (onProduct.has(f.id)) scope.frames.push(f);
    else report(f.id, "IO", `an ${f.epic ?? ""} frame is not on the product canvas`);
  }

  const design = new Set(DESIGN.map((f) => f.id));
  for (const f of canvas.filter((c) => !design.has(c.id))) {
    const kind = kindOf(f);
    if (kind === "ready") scope.ready += 1;
    if (kind === undefined) scope.drafts += 1;
    else scope.frames.push({ id: f.id, kind });
  }
  return scope;
};

// S13: the product canvas has a copy of the library tokens (Doop does not
// share tokens through a library). A change goes to the library first.
// S14 (E3): text on a surface, in each theme. --e-faint is left out: it is for disabled text only.
const CONTRAST_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["--e-text", "--e-bg"],
  ["--e-text", "--e-surface"],
  ["--e-text", "--e-tint"],
  ["--e-muted", "--e-bg"],
  ["--e-muted", "--e-surface"],
  ["--e-muted", "--e-tint"],
  ["--e-accent", "--e-surface"],
  ["--e-accent", "--e-accent-bg"],
  ["--e-danger", "--e-surface"],
  ["--e-warn", "--e-surface"],
  ["--e-ok", "--e-surface"],
  ["--e-on-accent", "--e-accent"],
  ["--e-on-primary", "--e-primary"],
];

// A token line is `color <light> dark=<dark>`; a theme with no value of its own keeps the light one.
const colourIn = (line: string | undefined, theme: string): string | undefined => {
  if (line === undefined) return undefined;
  const parts = line.split(" ");
  const own = parts.find((p) => p.startsWith(`${theme}=`));
  return own === undefined ? parts[1] : own.slice(theme.length + 1);
};

const luminance = (hex: string): number | undefined => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m === null) return undefined;
  const lin = (c: string | undefined): number => {
    const v = Number.parseInt(c ?? "0", 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
};

const checkContrast = (tokens: Map<string, string>): void => {
  for (const theme of ["light", "dark"]) {
    for (const [fg, bg] of CONTRAST_PAIRS) {
      const a = luminance(colourIn(tokens.get(fg), theme) ?? "");
      const b = luminance(colourIn(tokens.get(bg), theme) ?? "");
      if (a === undefined || b === undefined) {
        report(LIBRARY, "S14", `${fg} on ${bg} (${theme}) is not a #rrggbb colour`);
        continue;
      }
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < 4.5) {
        report(LIBRARY, "S14", `${fg} on ${bg} (${theme}) is ${ratio.toFixed(2)}:1, under 4.5:1`);
      }
    }
  }
};

const checkTokens = (tokens: Doop["tokens"]): void => {
  for (const [name, line] of tokens.library) {
    const copy = tokens.product.get(name);
    if (copy === undefined) report(PRODUCT, "S13", `${name} is not on the product canvas`);
    else if (copy !== line) report(PRODUCT, "S13", `${name} is ${copy}, the library has ${line}`);
  }
  for (const name of tokens.product.keys()) {
    if (!tokens.library.has(name)) report(PRODUCT, "S13", `${name} is not in the library`);
  }
};

const printScope = (scope: Scope): void => {
  const mains = scope.frames.filter((f) => f.kind === "main").length;
  console.log(
    `scope: ${EPICS.map((e) => `${e.frames.length} ${e.epic} frames`).join(", ")}, ${mains} system frames, ${scope.ready} frames that ask for sign-off; ${scope.drafts} drafts not checked\n`,
  );
};

// --- Design system: S1 to S4 ----------------------------------------------

type Decl = { selector: string; prop: string; value: string };

const declarations = (css: string): Array<Decl> => {
  const out: Array<Decl> = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of clean.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = (rule[1] ?? "").trim();
    for (const d of (rule[2] ?? "").split(";")) {
      const at = d.indexOf(":");
      const prop = d.slice(0, at).trim().toLowerCase();
      const value = d.slice(at + 1).trim();
      if (at > 0 && value !== "") out.push({ selector, prop, value });
    }
  }
  return out;
};

const classesIn = (css: string): Array<string> =>
  [...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\b(white|black|red|blue|gray|grey)\b/;
const SHAPE_PROPS = new Set(["font-size", "font-weight", "border-radius", "font-family"]);
const SHAPE_OK = /^(0|inherit|normal|none|50%|var\([^()]+\))$/;

// A shorthand such as `50% 50% 50% var(--e-radius-s)` passes if each part does.
const shapeOk = (value: string): boolean =>
  value.split(/\s+(?![^(]*\))/).every((part) => SHAPE_OK.test(part));

// --- Detail: S8 to S12 -----------------------------------------------------
// Sources: Emil Kowalski, emil-design-eng (motion); Vercel Web Interface
// Guidelines (motion, type, copy); Refactoring UI (spacing scale, elevation);
// Radix Themes (size and line-height pairs).

const DEPTH: Readonly<Record<string, number>> = { "(": 1, ")": -1, "{": 1, "}": -1 };

// Split on a separator that is not inside parentheses.
const splitTop = (value: string, sep: string): Array<string> => {
  const out: Array<string> = [];
  let depth = 0;
  let cur = "";

  for (const ch of value) {
    depth += DEPTH[ch] ?? 0;
    const cut = ch === sep && depth === 0;
    if (cut) out.push(cur.trim());
    cur = cut ? "" : cur + ch;
  }

  out.push(cur.trim());
  return out.filter((p) => p !== "");
};

const normal = (value: string): string =>
  value
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",")
    .trim();

const SPACE_PROP = /^(padding|margin|gap|row-gap|column-gap)(-|$)/;
const SPACE_OK = /^(0|auto|var\(--e-\d\))$/;
const LEADING_OK = /^(1|normal|inherit|var\(--e-leading-\d\))$/;
const SIZE_PROP = /^(min-|max-)?(width|height)$/;

// Elevation 1 (card), 2 (pin), 3 (popover, menu): a contact layer and an
// ambient layer, as Refactoring UI. Anything else is a ring.
const ELEVATION = new Set([
  "0 0 0 1px var(--e-line),0 1px 2px var(--e-shadow-low)",
  "0 1px 2px var(--e-shadow-mid),0 2px 6px var(--e-shadow-low)",
  "0 1px 2px var(--e-shadow-low),0 8px 24px var(--e-shadow-mid)",
]);

const RING =
  /^(inset )?(0 0 0 [1-3]px|-?[1-3]px 0 0) (var\(--e-[a-z-]+\)|color-mix\(in srgb,var\(--e-focus\) 18%,transparent\))$/;

const shadowOk = (value: string): boolean => {
  const v = normal(value);
  if (v.includes("--e-shadow")) return ELEVATION.has(v);

  return v === "none" || splitTop(v, ",").every((l) => RING.test(l));
};

const sizeOk = (value: string): boolean =>
  [...value.matchAll(/(-?\d*\.?\d+)px/g)].every((m) => Number(m[1]) % 4 === 0);

const EASE_OUT = "cubic-bezier(0.23,1,0.32,1)";

const durationsMs = (v: string): Array<number> =>
  [...v.matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)].map(
    (m) => Number(m[1]) * (m[2] === "s" ? 1000 : 1),
  );

type MotionRule = { why: string; bad: (prop: string, v: string) => boolean };

// A loop may run longer and ease in and out; nothing else may. A loop is an animation that runs for
// ever, or more than once: a bare number in it (no unit, outside a curve) is its count.
const isLoop = (p: string, v: string): boolean =>
  v.includes("infinite") ||
  (p.startsWith("animation") &&
    [...v.replace(/\([^)]*\)/g, "").matchAll(/(?<![\w.#-])(\d*\.?\d+)(?![\w.%-])/g)].some(
      (m) => Number(m[1]) > 1,
    ));

const MOTION_RULES: ReadonlyArray<MotionRule> = [
  { why: "names all", bad: (_p, v) => /\ball\b/.test(v) },
  {
    why: "moves more than transform and opacity",
    bad: (p, v) =>
      p === "transition" && splitTop(v, ",").some((t) => !/^(transform|opacity|none)\b/.test(t)),
  },
  {
    why: "is longer than 300ms",
    bad: (p, v) => !isLoop(p, v) && durationsMs(v).some((ms) => ms > 300),
  },
  { why: "eases in", bad: (_p, v) => /\bease-in\b(?!-out)/.test(v) },
  {
    why: "has a curve that is not the ease-out",
    bad: (_p, v) =>
      [...v.matchAll(/cubic-bezier\([^)]*\)/g)].some(
        (m) => normal(m[0]).replace(/ /g, "") !== EASE_OUT,
      ),
  },
  {
    why: "has a default curve",
    bad: (p, v) => !isLoop(p, v) && /\b(ease|linear|ease-in-out)\b(?!-)/.test(v),
  },
];

const checkMotion = (frame: string, what: string, d: Decl): void => {
  if (!/^(transition|animation)/.test(d.prop)) return;

  const v = normal(d.value);
  for (const r of MOTION_RULES) {
    if (r.bad(d.prop, v)) report(frame, "S10", `${what} ${r.why}`);
  }
};

type DeclRule = {
  rule: string;
  applies: (prop: string) => boolean;
  ok: (value: string) => boolean;
};

const DECL_RULES: ReadonlyArray<DeclRule> = [
  {
    rule: "S8",
    applies: (p) => SPACE_PROP.test(p),
    ok: (v) => splitTop(normal(v), " ").every((part) => SPACE_OK.test(part)),
  },
  { rule: "S9", applies: (p) => p === "line-height", ok: (v) => LEADING_OK.test(v) },
  { rule: "S11", applies: (p) => p === "box-shadow", ok: shadowOk },
  { rule: "S12", applies: (p) => SIZE_PROP.test(p), ok: sizeOk },
];

const checkDetail = (frame: string, what: string, d: Decl): void => {
  for (const r of DECL_RULES) if (r.applies(d.prop) && !r.ok(d.value)) report(frame, r.rule, what);

  checkMotion(frame, what, d);
};

const HOVER_MEDIA =
  /@media\s*\(\s*hover\s*:\s*hover\s*\)\s*and\s*\(\s*pointer\s*:\s*fine\s*\)\s*\{/;

const blockEnd = (css: string, open: number): number => {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    depth += DEPTH[css.charAt(i)] ?? 0;
    if (depth === 0) return i + 1;
  }
  return css.length;
};

const withoutHoverMedia = (css: string): string => {
  let out = css;
  for (let at = out.search(HOVER_MEDIA); at >= 0; at = out.search(HOVER_MEDIA)) {
    out = out.slice(0, at) + out.slice(blockEnd(out, out.indexOf("{", at)));
  }
  return out;
};

// S10 on a whole stylesheet: hover needs a fine pointer; motion needs a fallback.
const checkBlock = (frame: string, owner: string, css: string): void => {
  if (/:hover\b/.test(withoutHoverMedia(css))) {
    report(frame, "S10", `${owner} has :hover outside (hover:hover) and (pointer:fine)`);
  }

  const moves = /(transition|animation)\s*:\s*(?!none)/.test(css);
  if (moves && !css.includes("prefers-reduced-motion")) {
    report(frame, "S10", `${owner} moves with no prefers-reduced-motion fallback`);
  }
};

const checkDecl = (frame: string, owner: string, d: Decl): void => {
  if (d.prop.startsWith("--")) return;

  const what = `${owner} ${d.selector} ${d.prop}: ${d.value}`;
  if (COLOUR.test(d.value)) report(frame, "S1", what);
  if (SHAPE_PROPS.has(d.prop) && !shapeOk(d.value)) report(frame, "S2", what);
  checkDetail(frame, what, d);
};

// A component's CSS is the same in each frame: report it on the system, once.
const checkCss = (frame: string, parsed: Parsed): void => {
  for (const block of parsed.css) {
    const comp = COMPONENTS[block.owner];
    const where = comp === undefined ? frame : "system";
    const owner = comp ?? block.owner;
    checkBlock(where, owner, block.css);
    for (const d of declarations(block.css)) checkDecl(where, owner, d);
  }
};

// --- Copy: T1 --------------------------------------------------------------

const COPY_RULES: ReadonlyArray<{ why: string; bad: RegExp }> = [
  { why: "three dots, not …", bad: /\.\.\./ },
  { why: "a straight quote, not “ ”", bad: /"/ },
  { why: "a straight apostrophe, not ’", bad: /\w'\w/ },
  {
    why: "a plain space between a number and its unit",
    bad: /\b\d+ (min|h|days?|hours?|ms|s|px|MB|KB)\b/,
  },
];

const checkCopy = (frame: string, parsed: Parsed): void => {
  for (const line of parsed.copy.split("\n")) {
    for (const r of COPY_RULES) {
      if (r.bad.test(line)) report(frame, "T1", `${r.why}: ${line.trim().slice(0, 60)}`);
    }
  }
};

const componentClasses = (parsed: Parsed): Map<string, string> => {
  const owned = new Map<string, string>();
  for (const c of parsed.css) {
    const name = COMPONENTS[c.owner];
    if (name !== undefined) for (const cls of classesIn(c.css)) owned.set(cls, name);
  }
  return owned;
};

const checkRestyle = (frame: string, parsed: Parsed): void => {
  const owned = componentClasses(parsed);
  const frameCss = parsed.css.filter((c) => c.owner === "frame").map((c) => c.css);
  for (const cls of new Set(classesIn(frameCss.join("\n")))) {
    const owner = owned.get(cls);
    if (owner !== undefined) report(frame, "S4", `the frame styles .${cls} of ${owner}`);
  }
};

// --- Instances: requirements and S5 to S7 ---------------------------------

type Proof = {
  // Each requirement ID of a designed epic, and its epic.
  epic: Map<string, string>;
  shown: Map<string, Array<string>>;
  badgeStates: Set<string>;
  revs: Map<string, Map<string, string>>;
  badgeCss: string;
};

type Check = (proof: Proof, f: Frame, parsed: Parsed, i: Instance) => void;

const compName = (i: Instance): string => COMPONENTS[i.comp] ?? i.comp;

const within = (child: Instance, ancestor: Instance): boolean => {
  for (let p = child.parent; p !== undefined; p = p.parent) if (p === ancestor) return true;
  return false;
};

const noteIds = (i: Instance): Array<string> => {
  const ids = i.props.ids ?? i.text;
  return [...ids.matchAll(/\b([A-Z]\d{1,2})\b/g)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );
};

const noteTitle = (i: Instance): string =>
  i.props.title ?? i.text.split(/[A-Z]\d/)[0]?.trim() ?? "";

const checkRef: Check = (_proof, f, _parsed, i) => {
  if ((i.props.ref ?? "") !== "") return;

  report(f.id, "R5", `${compName(i)} "${i.text.slice(0, 40)}" has no reference`);
};

const checkComposer: Check = (_proof, f, _parsed, i) => {
  if (i.props.state !== "error") return;

  if ((i.props.hint ?? "") === "") report(f.id, "R6", "error Composer says no reason");
  if (i.props.filled !== "yes") report(f.id, "R6", "error Composer does not keep the text");
};

const checkPrimaries: Check = (_proof, f, parsed, i) => {
  const primaries = parsed.instances.filter(
    (b) => compName(b) === "Button" && b.props.tone === "primary" && within(b, i),
  );
  if (primaries.length > 1) report(f.id, "S6", `Popover has ${primaries.length} primary buttons`);
};

const noteBadge: Check = (proof, _f, _parsed, i) => {
  proof.badgeStates.add(i.props.state ?? "waiting");
};

const traceNote: Check = (proof, f, _parsed, i) => {
  if (f.kind !== "sheet") return;

  const title = noteTitle(i);
  for (const id of noteIds(i)) {
    if (proof.epic.get(id) !== f.epic) {
      report(f.id, "R2", `"${title}" names ${id}, not an ${f.epic ?? ""} ID`);
    }
    proof.shown.set(id, [...(proof.shown.get(id) ?? []), title]);
  }
};

const CHECKS: Readonly<Record<string, Check>> = {
  StateBadge: noteBadge,
  ThreadHead: checkRef,
  RequestRow: checkRef,
  Composer: checkComposer,
  Popover: checkPrimaries,
  StateNote: traceNote,
};

const noteRev = (proof: Proof, f: Frame, name: string, i: Instance): void => {
  if (i.main) return;

  const byRev = proof.revs.get(name) ?? new Map<string, string>();
  byRev.set(i.rev, f.id);
  proof.revs.set(name, byRev);
};

const checkInstance = (proof: Proof, f: Frame, parsed: Parsed, i: Instance): void => {
  const name = COMPONENTS[i.comp];
  if (name === undefined) {
    report(f.id, "S7", `instance of ${i.comp} is not in the system`);
    return;
  }

  noteRev(proof, f, name, i);
  CHECKS[name]?.(proof, f, parsed, i);
};

const checkFrame = (proof: Proof, f: Frame, parsed: Parsed): void => {
  checkCss(f.id, parsed);
  checkCopy(f.id, parsed);
  for (const tag of parsed.natives) report(f.id, "S3", `a native <${tag}> outside a component`);
  checkRestyle(f.id, parsed);

  const badge = parsed.css.find((b) => b.owner === BADGE);
  if (badge !== undefined) proof.badgeCss = badge.css;

  for (const i of parsed.instances) checkInstance(proof, f, parsed, i);
  if (f.kind === "screen" && !parsed.instances.some((i) => i.comp === COUNT)) {
    report(f.id, "R4", "full screen shows no count (F2: always visible)");
  }
};

// --- Canvas: R1, R3, S5 ---------------------------------------------------

const readEpicIds = async (): Promise<Map<string, string>> => {
  const text = await Bun.file("docs/epics.md").text();
  const out = new Map<string, string>();
  for (const { epic } of EPICS) {
    const start = text.indexOf(`## ${epic}:`);
    const end = text.indexOf("\n## E", start + 1);
    const part = text.slice(start, end === -1 ? undefined : end);
    for (const m of part.matchAll(/^\| ([A-Z]\d+)\s+\|/gm)) {
      if (m[1] !== undefined) out.set(m[1], epic);
    }
  }
  return out;
};

const checkTrace = (proof: Proof): void => {
  for (const id of proof.epic.keys()) {
    const shown = proof.shown.has(id);
    const elsewhere = NOT_SHOWN[id] !== undefined;
    if (!shown && !elsewhere) report(PRODUCT, "R1", `${id} shows on no state`);
    if (shown && elsewhere) report(PRODUCT, "R1", `${id} is in NOT_SHOWN but a state shows it`);
  }
};

const stateLook = (css: string, state: string): string =>
  declarations(css)
    .filter(
      (d) =>
        d.selector.includes(`data-state="${state}"`) || d.selector.includes(`data-state=${state}]`),
    )
    .map((d) => `${d.selector.replace(/data-state=("?)\w+\1/, "")}{${d.prop}:${d.value}}`)
    .sort()
    .join(";");

const checkF1 = (proof: Proof): void => {
  const looks = new Map<string, string>();
  for (const s of F1_STATES) {
    if (!proof.badgeStates.has(s)) report(PRODUCT, "R3", `F1 state ${s} shows on no frame`);

    const look = stateLook(proof.badgeCss, s);
    const same = [...looks.entries()].find(([, v]) => v === look);
    if (same !== undefined) report(PRODUCT, "R3", `F1 states ${same[0]} and ${s} look the same`);
    looks.set(s, look);
  }
};

const checkRevs = (proof: Proof): void => {
  for (const [name, byRev] of proof.revs) {
    if (byRev.size > 1) {
      report(PRODUCT, "S5", `${name} is at revisions ${[...byRev.keys()].join(", ")}`);
    }
  }
};

const printReport = (proof: Proof): number => {
  const lines = [...new Set(findings.map((f) => `${f.frame} ${f.rule} ${f.what}`))];
  for (const line of lines) console.log(line);

  const traced = [...proof.shown.entries()]
    .filter(([id]) => proof.epic.has(id))
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }));
  const elsewhere = Object.keys(NOT_SHOWN).length;
  const epics = EPICS.map((e) => e.epic).join(" and ");
  console.log(
    `\ntrace: ${traced.length} of ${proof.epic.size} ${epics} IDs show on a state; ${elsewhere} are proven elsewhere`,
  );
  for (const [id, titles] of traced) console.log(`  ${id}: ${[...new Set(titles)].join(" | ")}`);
  for (const [id, why] of Object.entries(NOT_SHOWN)) console.log(`  ${id}: (elsewhere) ${why}`);

  if (lines.length === 0) {
    console.log("\ndesign proof: OK");
    return 0;
  }

  console.log(`\ndesign proof: ${lines.length} findings. Fix each in Doop, then run it again.`);
  return 1;
};

const main = async (): Promise<number> => {
  const key = await readKey();
  const proof: Proof = {
    epic: await readEpicIds(),
    shown: new Map(),
    badgeStates: new Set(),
    revs: new Map(),
    badgeCss: "",
  };

  const doop = await readDoop(key);
  const scope = chooseFrames(doop.frames);
  printScope(scope);
  checkTokens(doop.tokens);
  checkContrast(doop.tokens.library);

  // Fetch in parallel, check in order, so the report has one order.
  const frames = await Promise.all(
    scope.frames.map(async (f) => ({ f, parsed: await loadFrame(f, key) })),
  );
  for (const { f, parsed } of frames) if (parsed !== undefined) checkFrame(proof, f, parsed);

  checkTrace(proof);
  checkF1(proof);
  checkRevs(proof);
  return printReport(proof);
};

process.exit(await main());

export {};
