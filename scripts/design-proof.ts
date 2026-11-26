import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createScope } from "@tinkered/core";
import type { Scope as TinkerScope } from "@tinkered/core";
import { z } from "zod";

import { contrast } from "@/kit/compose";
import { liveName } from "@/live/plan";
import { livePage, notScreens, screens, statusName, takeKeys } from "@/live/screens";
import { liveStatusRead } from "@/live/status";
import type { LiveStatus } from "@/live/status";
import { liveColor, liveFindings, liveLook } from "@/live/values";

const LIBRARY = "design-system";
const PRODUCT = "product";

type Kind = "screen" | "page" | "sheet" | "main" | "ready";

const EPIC_PAGES: Readonly<Record<string, string>> = {
  "work-e3-share-and-look": "E3",
  "work-e4-comment-and-get-a-change": "E4",
  "work-e4-click-path-copies": "E4",
};

const EPICS: ReadonlyArray<{ epic: string }> = [{ epic: "E3" }, { epic: "E4" }];

const E8_PAGE = "work-e8-one-look-fast";

const E8_KIT = /^E8\.W0\d /;

const SYSTEM_PAGES = new Set(["foundations", "primitives", "patterns", "layout"]);

const READY = new Set(["ready"]);

const GATE_PAGES = new Set([
  "92ffa216152c",
  "8057f74d0b28",
  "69dcb0267245",
  "1bf47f73177a",
  "7567aff1ede6",
  "4173189a5406",
  "0c4db7d0a698",
  "8e794de3670e",
  "5ae48f92fadf",
  "25aa7d7c4776",
]);

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
  D1: "one queue: SPEC-queue, queue-lease chart",
  D2: "an agent that asks gets work: SPEC-queue (M7)",
  D6: "a delivery starts an agent: SPEC-queue, queue-dispatch chart",
  D7: "the team lead sets channels: SPEC-queue, easel channel set",
  D8: "one outcome for each request: queue-dispatch chart",
  D9: "the way and its cause: SPEC-queue, easel deliveries",
  D10: "GitHub issues follow requests: SPEC-queue, queue-dispatch chart",
  D11: "only the person starts the work of an agent: SPEC-starts, starts chart",
  D12: "the limits of the agents: SPEC-starts, starts chart",
  D13: "the cause of a wait or a failed start: SPEC-starts, starts chart",
  S11: "200 frames stay smooth: tests/browser/viewer-canvas.test.tsx (p95 handler time)",
};

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

type Frame = { id: string; kind: Kind; canvas: string; epic?: string };

type Instance = {
  frame: string;
  comp: string;
  rev: string;
  props: Record<string, string>;
  text: string;
  parent: Instance | undefined;
  main: boolean;
};

type Css = { owner: string; css: string };

type Parsed = {
  instances: Array<Instance>;
  css: Array<Css>;
  natives: Array<string>;
  copy: string;
};

type Finding = { frame: string; rule: string; what: string };

const findings: Array<Finding> = [];

const report = (frame: string, rule: string, what: string): void => {
  findings.push({ frame, rule, what });
};

const hostsFile = z.object({
  default: z.string(),
  hosts: z.record(
    z.string(),
    z.object({ user: z.object({ name: z.string(), token: z.string() }) }),
  ),
});

type Login = { server: string; token: string; name: string };

const readLogin = (): Login => {
  const home = process.env.EASEL_CONFIG_HOME || join(process.env.HOME ?? "", ".config/easel-agent");
  const hosts = hostsFile.parse(JSON.parse(readFileSync(join(home, "easel/hosts.json"), "utf8")));
  const user = hosts.hosts[hosts.default]?.user;
  if (!user) throw new Error(`design proof: no login for ${hosts.default} in ${home}`);
  return { server: hosts.default, token: user.token, name: user.name };
};

let calls = 0;

const callTool = async (
  login: Login,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> => {
  const res = await fetch(`${login.server}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${login.token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++calls,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

  const body: unknown = await res.json();
  const result = isRecord(body) ? body.result : undefined;
  const text = listOf(result, "content")
    .map((c) => field(c, "text"))
    .join("");
  if (!res.ok || text === "") throw new Error(`design proof: ${name} failed (HTTP ${res.status})`);

  return JSON.parse(text);
};

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

type Open = {
  inst: Instance | undefined;
  sample: boolean;
  raw: boolean;
  style: Css | undefined;
  prop: string | undefined;
};

type ReadState = { frame: string; stack: Array<Open>; parsed: Parsed };

const NATIVE = new Set(["button", "input", "textarea", "select"]);

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

  const owner =
    el.getAttribute("data-doop-component-css") ??
    el.getAttribute("data-doop-component-source") ??
    "frame";
  const block = { owner, css: "" };
  s.parsed.css.push(block);
  return block;
};

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

const htmlOf = async (login: Login, canvas: string, id: string): Promise<string | undefined> => {
  const got = await callTool(login, "show_frame_parts", { canvas, id });
  const html = field(got, "html");
  return html === "" ? undefined : html;
};

const loadFrame = async (f: Frame, login: Login): Promise<Parsed | undefined> => {
  const html = await htmlOf(login, f.canvas, f.id);
  if (html === undefined) {
    report(f.id, "IO", "the frame has no document");
    return undefined;
  }

  noteTokens(f.id, html);
  return parseFrame(f.id, html);
};

type CanvasFrame = {
  canvas: string;
  id: string;
  name: string;
  page: string;
  status: string;
  w: number;
  h: number;
  version: number;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const field = (v: unknown, k: string): string => {
  if (!isRecord(v)) return "";
  const out = v[k];
  return typeof out === "string" ? out : "";
};

const count = (v: unknown, k: string): number => {
  if (!isRecord(v)) return 0;
  const out = v[k];
  return typeof out === "number" ? out : 0;
};

const listOf = (v: unknown, k: string): Array<unknown> => {
  if (!isRecord(v)) return [];
  const out: unknown = v[k];
  return Array.isArray(out) ? out : [];
};

type Themed = { light?: string; dark?: string };

const tokenBlocks = new Map<string, Map<string, Themed>>();

const tokenPairs = (body: string): Array<[string, string]> =>
  body
    .split(";")
    .map((d) => [
      d.slice(0, Math.max(d.indexOf(":"), 0)).trim(),
      d.slice(d.indexOf(":") + 1).trim(),
    ])
    .filter((pair): pair is [string, string] => pair[0] !== "");

const noteTokens = (frame: string, html: string): void => {
  const own = new Map<string, Themed>();
  const css = [...html.matchAll(/<style data-doop-tokens>([\s\S]*?)<\/style>/g)]
    .map((block) => block[1] ?? "")
    .join("\n");
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const theme = (rule[1] ?? "").includes("dark") ? "dark" : "light";
    for (const [name, value] of tokenPairs(rule[2] ?? "")) {
      own.set(name, { ...own.get(name), [theme]: value });
    }
  }

  tokenBlocks.set(frame, own);
};

const framesOf = async (login: Login, canvas: string): Promise<Array<CanvasFrame>> => {
  const body = await callTool(login, "list_frames", { canvas });
  return listOf(body, "frames").map((f) => ({
    canvas,
    id: field(f, "id"),
    name: field(f, "name"),
    page: field(f, "page"),
    status: field(f, "status"),
    w: count(f, "w"),
    h: count(f, "h"),
    version: count(f, "version"),
  }));
};

type Scope = { frames: Array<Frame>; ready: number; drafts: number; epics: Map<string, number> };

const epicKind = (f: CanvasFrame): Kind | undefined => {
  if (f.name.includes(" states: ")) return "sheet";
  if (GATE_PAGES.has(f.id)) return "page";

  return f.w === 1280 && f.h === 800 ? "screen" : undefined;
};

const kindOf = (f: CanvasFrame): Kind | undefined => {
  if (f.canvas === LIBRARY) return SYSTEM_PAGES.has(f.page) ? "main" : undefined;

  const kind = EPIC_PAGES[f.page] === undefined ? undefined : epicKind(f);

  return kind ?? (READY.has(f.status) ? "ready" : undefined);
};

const chooseFrames = (canvas: Array<CanvasFrame>): Scope => {
  const scope: Scope = { frames: [], ready: 0, drafts: 0, epics: new Map() };
  for (const f of canvas.filter((c) => c.page !== livePage.key && c.page !== E8_PAGE)) {
    const kind = kindOf(f);
    const epic = EPIC_PAGES[f.page];
    if (kind === "ready") scope.ready += 1;

    if (kind === undefined) {
      scope.drafts += 1;
      continue;
    }
    scope.frames.push({ id: f.id, kind, canvas: f.canvas, ...(epic ? { epic } : {}) });

    if (epic) scope.epics.set(epic, (scope.epics.get(epic) ?? 0) + 1);
  }
  return scope;
};

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

const luminance = (hex: string): number | undefined => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m === null) return undefined;
  const lin = (c: string | undefined): number => {
    const v = Number.parseInt(c ?? "0", 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
};

const libraryTokens = (canvas: Array<CanvasFrame>): Map<string, Themed> => {
  const out = new Map<string, Themed>();
  for (const f of canvas.filter((c) => c.canvas === LIBRARY)) {
    for (const [name, themed] of tokenBlocks.get(f.id) ?? []) {
      out.set(name, { ...out.get(name), ...themed });
    }
  }
  return out;
};

const contrastFinding = (
  tokens: Map<string, Themed>,
  [fg, bg]: readonly [string, string],
  theme: "light" | "dark",
): string | null => {
  const a = luminance(tokens.get(fg)?.[theme] ?? "");
  const b = luminance(tokens.get(bg)?.[theme] ?? "");
  if (a === undefined || b === undefined) {
    return `${fg} on ${bg} (${theme}) is not a #rrggbb colour`;
  }

  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  return ratio < 4.5 ? `${fg} on ${bg} (${theme}) is ${ratio.toFixed(2)}:1, under 4.5:1` : null;
};

const checkContrast = (tokens: Map<string, Themed>): void => {
  for (const theme of ["light", "dark"] as const) {
    for (const pair of CONTRAST_PAIRS) {
      const found = contrastFinding(tokens, pair, theme);
      if (found !== null) report(LIBRARY, "S14", found);
    }
  }
};

const sameValue = (scope: TinkerScope.Handle, a: string, b: string): boolean => {
  const x = scope.run(liveColor, { input: a });
  const y = scope.run(liveColor, { input: b });
  if (x.kind === "color" && y.kind === "color") return x.key === y.key;
  return a.replace(/\s+/g, " ") === b.replace(/\s+/g, " ");
};

const checkToken = (
  scope: TinkerScope.Handle,
  name: string,
  themed: Themed,
  own: Themed | undefined,
): void => {
  if (own === undefined) {
    report(PRODUCT, "S13", `${name} is not in the design system`);
    return;
  }

  for (const theme of ["light", "dark"] as const) {
    const copy = themed[theme] ?? "";
    const main = own[theme] ?? "";
    if (copy !== "" && main !== "" && !sameValue(scope, copy, main)) {
      report(PRODUCT, "S13", `${name} (${theme}) is ${copy}, the design system has ${main}`);
    }
  }
};

const checkTokens = (
  scope: TinkerScope.Handle,
  library: Map<string, Themed>,
  frames: Array<Frame>,
): void => {
  for (const f of frames.filter((one) => one.canvas === PRODUCT)) {
    for (const [name, themed] of tokenBlocks.get(f.id) ?? []) {
      checkToken(scope, name, themed, library.get(name));
    }
  }
};

const printScope = (scope: Scope, e8: number): void => {
  const mains = scope.frames.filter((f) => f.kind === "main").length;
  console.log(
    `scope: ${EPICS.map((e) => `${scope.epics.get(e.epic) ?? 0} ${e.epic} frames`).join(", ")}, ${e8} E8 kit frames, ${mains} system frames, ${scope.ready} frames that ask for sign-off; ${scope.drafts} drafts not checked\n`,
  );
};

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

const shapeOk = (value: string): boolean =>
  value.split(/\s+(?![^(]*\))/).every((part) => SHAPE_OK.test(part));

const DEPTH: Readonly<Record<string, number>> = { "(": 1, ")": -1, "{": 1, "}": -1 };

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

const checkCss = (frame: string, parsed: Parsed): void => {
  for (const block of parsed.css) {
    const comp = COMPONENTS[block.owner];
    const where = comp === undefined ? frame : "system";
    const owner = comp ?? block.owner;
    checkBlock(where, owner, block.css);
    for (const d of declarations(block.css)) checkDecl(where, owner, d);
  }
};

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

type Proof = {
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

const styleById = (html: string, id: string): string | undefined =>
  new RegExp(`<style id="${id}">([\\s\\S]*?)</style>`).exec(html)?.[1];

const lookValuesOf = (css: string): Record<string, string> =>
  Object.fromEntries(
    [...css.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]),
  );

const readE8Ids = async (): Promise<Set<string>> => {
  const text = await Bun.file("docs/epics.md").text();
  const start = text.indexOf("## E8:");
  const end = text.indexOf("\n## E", start + 1);
  const part = text.slice(start, end === -1 ? undefined : end);
  return new Set([...part.matchAll(/^\| (K\d+)\s+\|/gm)].flatMap((m) => (m[1] ? [m[1]] : [])));
};

const checkE8Name = (f: CanvasFrame, ids: Set<string>): void => {
  const claimed = /\(([^()]*)\)\s*$/.exec(f.name)?.[1] ?? "";
  for (const m of claimed.matchAll(/\b([A-Z]\d{1,2})\b/g)) {
    if (m[1] !== undefined && !ids.has(m[1])) {
      report(f.id, "R2", `"${f.name}" names ${m[1]}, not an E8 ID`);
    }
  }
};

const checkE8Pairs = (scope: TinkerScope.Handle, id: string, html: string): void => {
  const look = styleById(html, "easel-look");
  const kit = styleById(html, "easel-kit");
  if (look === undefined || kit === undefined) {
    report(id, "K8", "no easel-look or easel-kit block: the frame is not composed with the kit");
    return;
  }

  const pairs = scope.run(contrast, { input: { look: lookValuesOf(look), css: kit } });
  if (pairs.length < 25) report(id, "K8", `only ${pairs.length} pairs found in the kit`);

  for (const p of pairs.filter((q) => q.ratio < q.min)) {
    const named = p.theme ? `${p.theme}: ` : "";
    report(id, "K8", `${named}${p.text} on ${p.on} is ${p.ratio}:1, needs ${p.min}:1 (${p.where})`);
  }
};

const checkE8 = async (
  scope: TinkerScope.Handle,
  canvas: Array<CanvasFrame>,
  login: Login,
): Promise<number> => {
  const ids = await readE8Ids();
  const kit = canvas.filter((f) => f.page === E8_PAGE && E8_KIT.test(f.name));
  for (const f of kit) {
    const html = await htmlOf(login, PRODUCT, f.id);
    if (html === undefined) {
      report(f.id, "IO", "an E8 frame has no document");
      continue;
    }
    checkE8Name(f, ids);
    checkE8Pairs(scope, f.id, html);
  }
  return kit.length;
};

const liveBuild = async (login: Login): Promise<number> => {
  const res = await fetch(`${login.server}/api/version`);
  const body: unknown = await res.json();
  return count(body, "build");
};

const checkLiveNames = (
  scope: TinkerScope.Handle,
  onProduct: Array<CanvasFrame>,
  onLive: Map<string, CanvasFrame>,
): void => {
  for (const s of screens) {
    const designed = onProduct.find((f) => f.id === s.design.id);
    if (designed?.name !== s.design.name) {
      report(
        s.design.id,
        "V1",
        `the screen ${s.key} names "${s.design.name}", not a frame of product`,
      );
    }

    for (const take of takeKeys) {
      const name = scope.run(liveName, { input: { role: "live", design: s.design.name, take } });
      if (!onLive.has(name)) report(PRODUCT, "V1", `no live screen "${name}" on the page Live`);
    }
  }
};

const checkAccepted = async (login: Login): Promise<void> => {
  const listed = new Set<string>(screens.map((s) => s.design.id));
  const accepted = await callTool(login, "list_requests", { canvas: PRODUCT, state: "accepted" });
  const missing = listOf(accepted, "requests").filter((r) => {
    const frame = field(r, "frameId");
    return frame !== "" && !listed.has(frame) && notScreens[frame] === undefined;
  });

  for (const r of missing) {
    report(
      field(r, "frameId"),
      "V1",
      `#${count(r, "n")} accepted a design of this frame, and no live screen has it`,
    );
  }
};

const checkTakes = (status: LiveStatus, build: number): void => {
  console.log(`live: the page Live has build ${status.build}, the site serves build ${build}`);
  if (status.build !== build) {
    report(
      PRODUCT,
      "V1",
      `the page Live has build ${status.build}, the site serves build ${build}`,
    );
  }

  for (const t of status.takes.filter((one) => one.word === "differs" || one.word === "failed")) {
    const rule = t.word === "differs" ? "V2" : "V1";
    report(PRODUCT, rule, `${t.screen} ${t.take}: ${t.word}${t.why ? `: ${t.why}` : ""}`);
  }
};

const checkValues = (
  scope: TinkerScope.Handle,
  status: LiveStatus,
  library: Map<string, Themed>,
): void => {
  const css = [...library]
    .map(([name, themed]) => {
      const light = themed.light ?? themed.dark ?? "";
      const dark = themed.dark ?? themed.light ?? "";
      return `${name}:${light};${name}:${dark};`;
    })
    .join("");
  const look = scope.run(liveLook, { input: css });

  for (const f of scope.run(liveFindings, { input: { look, values: status.values } })) {
    const where = f.where ? ` (${f.where})` : "";
    report(
      PRODUCT,
      "V6",
      `${f.screen} ${f.take}: the ${f.kind} ${f.value} is not in the design system${where}`,
    );
  }
};

const checkLive = async (
  scope: TinkerScope.Handle,
  canvas: Array<CanvasFrame>,
  library: Map<string, Themed>,
  login: Login,
): Promise<void> => {
  const onProduct = canvas.filter((f) => f.canvas === PRODUCT);
  const onLive = new Map(onProduct.filter((f) => f.page === livePage.key).map((f) => [f.name, f]));
  checkLiveNames(scope, onProduct, onLive);
  await checkAccepted(login);

  const statusFrame = onLive.get(statusName);
  const html = statusFrame ? await htmlOf(login, PRODUCT, statusFrame.id) : undefined;
  const read = scope.run(liveStatusRead, { input: html ?? "" });
  if (read.kind !== "read") {
    report(PRODUCT, "V1", `no data in "${statusName}" on the page Live`);
    return;
  }

  checkTakes(read.status, await liveBuild(login));
  checkValues(scope, read.status, library);
};

const partDrift = (proof: Proof): void => {
  const behind = [...proof.revs.entries()].filter(([, byRev]) => byRev.size > 1);
  const parts = behind.map(([name, byRev]) => `${name} (${byRev.size} copies)`).join(", ");
  console.log(
    `parts: ${behind.length === 0 ? "each copy of a part on product shows one revision" : `copies of a part differ: ${parts}`}. The frames are read as a tab shows them: each linked copy has the part of the current kit version (SPEC-pieces-base, V5).`,
  );
};

const checkEdited = async (login: Login, checked: ReadonlySet<string>): Promise<void> => {
  const listed = await callTool(login, "list_parts", {});
  for (const part of listOf(listed, "parts")) {
    for (const copy of listOf(part, "copies")) {
      const edited = count(copy, "edited");
      if (field(copy, "canvas") !== PRODUCT || edited === 0 || !checked.has(field(copy, "id"))) {
        continue;
      }
      const what = `${field(part, "name")}: ${edited} edited copies do not follow the part; put them again as copies, with props and overrides`;
      report(field(copy, "id"), "S5", what);
    }
  }
};

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

  console.log(
    `\ndesign proof: ${lines.length} findings. Fix each in easel or in the code, then run it again.`,
  );
  return 1;
};

const main = async (): Promise<number> => {
  const login = readLogin();
  console.log(`easel: ${login.server} as ${login.name}\n`);
  const proof: Proof = {
    epic: await readEpicIds(),
    shown: new Map(),
    badgeStates: new Set(),
    revs: new Map(),
    badgeCss: "",
  };

  const canvas = [...(await framesOf(login, LIBRARY)), ...(await framesOf(login, PRODUCT))];
  const scope = chooseFrames(canvas);
  const tinker = createScope({});

  const frames = await Promise.all(
    scope.frames.map(async (f) => ({ f, parsed: await loadFrame(f, login) })),
  );
  const library = libraryTokens(canvas);
  checkTokens(tinker, library, scope.frames);
  checkContrast(library);
  for (const { f, parsed } of frames) if (parsed !== undefined) checkFrame(proof, f, parsed);

  const e8 = await checkE8(tinker, canvas, login);
  printScope(scope, e8);
  checkTrace(proof);
  checkF1(proof);
  checkRevs(proof);
  await checkEdited(login, new Set(scope.frames.map((f) => f.id)));
  await checkLive(tinker, canvas, library, login);
  partDrift(proof);
  await tinker.close();
  return printReport(proof);
};

process.exit(await main());
