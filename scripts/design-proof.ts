// Proof that the E4 design meets its requirements and the design system.
//
// The design review is a loop: requirement, design, proof, review, then a
// correction to the requirement or to the design. This script is the proof
// step. It reads the live HTML of each frame on the Doop canvas and checks it
// against docs/epics.md and against the canvas's components and tokens.
//
// Usage: bun scripts/design-proof.ts
// Key: DOOP_KEY, or the file ~/.config/secrets/doop-agent-key.
//
// One finding is one line: `<frame> <rule id> <what is there>`.
// Rules:
//   R1 each E4 ID shows on a state of a sheet, or is in NOT_SHOWN with a reason.
//   R2 each ID on a sheet is an E4 ID in docs/epics.md.
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

const CANVAS = "zPdfXgdRrQ";
const API = "https://doop.vibea.dev/api/frames";

type Kind = "screen" | "sheet";

const FRAMES: ReadonlyArray<{ id: string; kind: Kind }> = [
  { id: "XdLqS2sMuW", kind: "screen" },
  { id: "VEhtXVmP1c", kind: "screen" },
  { id: "zECrJhEKRK", kind: "screen" },
  { id: "iYUS96Dpzk", kind: "screen" },
  { id: "K_IqwF_EM6", kind: "screen" },
  { id: "9qxCwwYNk9", kind: "screen" },
  { id: "renIl7fo8K", kind: "sheet" },
  { id: "1A1h0JmwpC", kind: "sheet" },
  { id: "cntUqBSroa", kind: "sheet" },
  { id: "AzGdKz1J0q", kind: "sheet" },
];

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
};

// E4 IDs that no picture can prove. Each one is proven elsewhere.
const NOT_SHOWN: Readonly<Record<string, string>> = {
  M1: "order of the queue: SPEC-queue, queue-lease chart",
  M3: "what an agent gets: SPEC-queue, SPEC-mcp",
  M4: "lease ends: SPEC-queue, queue-lease chart",
  M6: "an agent gives back: SPEC-queue; the viewer sees it as P2",
  M7: "agent wait time: SPEC-queue",
  M8: "scope of a change: SPEC-queue, SPEC-mcp",
  N7: "a pin moves with its frame: SPEC-viewer",
  F4: "time to show: SPEC-viewer live board",
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

type Frame = { id: string; kind: Kind };

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
  const style = openStyle(s, el, tag);
  if (el.selfClosing || !el.canHaveContent) return;

  s.stack.push({ inst, sample, style, prop: mainProp(s, el, inst) });
  el.onEndTag(() => {
    s.stack.pop();
  });
};

const addPropText = (s: ReadState, open: Open | undefined, text: string): void => {
  const inst = nearestInstance(s);
  if (open?.prop === undefined || inst === undefined) return;

  inst.props[open.prop] = (inst.props[open.prop] ?? "") + text;
};

const onText = (s: ReadState, t: HTMLRewriterTypes.Text): void => {
  const open = top(s);
  if (open?.style !== undefined) {
    open.style.css += t.text;
    return;
  }

  for (const o of s.stack) if (o.inst !== undefined) o.inst.text += t.text;
  addPropText(s, open, t.text);
};

const parseFrame = async (frame: string, html: string): Promise<Parsed> => {
  const s: ReadState = { frame, stack: [], parsed: { instances: [], css: [], natives: [] } };
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

const checkDecl = (frame: string, owner: string, d: Decl): void => {
  if (d.prop.startsWith("--")) return;

  const what = `${owner} ${d.selector} ${d.prop}: ${d.value}`;
  if (COLOUR.test(d.value)) report(frame, "S1", what);
  if (SHAPE_PROPS.has(d.prop) && !shapeOk(d.value)) report(frame, "S2", what);
};

const checkCss = (frame: string, parsed: Parsed): void => {
  for (const block of parsed.css) {
    const owner = COMPONENTS[block.owner] ?? block.owner;
    for (const d of declarations(block.css)) checkDecl(frame, owner, d);
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
  epic: Set<string>;
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
  return [...ids.matchAll(/\b([NMPF]\d{1,2})\b/g)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );
};

const noteTitle = (i: Instance): string =>
  i.props.title ?? i.text.split(/[NMPF]\d/)[0]?.trim() ?? "";

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
    if (!proof.epic.has(id)) report(f.id, "R2", `"${title}" names ${id}, not an E4 ID`);
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

const readEpicIds = async (): Promise<Set<string>> => {
  const text = await Bun.file("docs/epics.md").text();
  const e4 = text.slice(text.indexOf("## E4:"), text.indexOf("## E5:"));
  const ids = [...e4.matchAll(/^\| ([NMPF]\d+)\s+\|/gm)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );
  return new Set(ids);
};

const checkTrace = (proof: Proof): void => {
  for (const id of proof.epic) {
    const shown = proof.shown.has(id);
    const elsewhere = NOT_SHOWN[id] !== undefined;
    if (!shown && !elsewhere) report(CANVAS, "R1", `${id} shows on no state`);
    if (shown && elsewhere) report(CANVAS, "R1", `${id} is in NOT_SHOWN but a state shows it`);
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
    if (!proof.badgeStates.has(s)) report(CANVAS, "R3", `F1 state ${s} shows on no frame`);

    const look = stateLook(proof.badgeCss, s);
    const same = [...looks.entries()].find(([, v]) => v === look);
    if (same !== undefined) report(CANVAS, "R3", `F1 states ${same[0]} and ${s} look the same`);
    looks.set(s, look);
  }
};

const checkRevs = (proof: Proof): void => {
  for (const [name, byRev] of proof.revs) {
    if (byRev.size > 1) {
      report(CANVAS, "S5", `${name} is at revisions ${[...byRev.keys()].join(", ")}`);
    }
  }
};

const printReport = (proof: Proof): number => {
  for (const f of findings) console.log(`${f.frame} ${f.rule} ${f.what}`);

  const traced = [...proof.shown.entries()]
    .filter(([id]) => proof.epic.has(id))
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }));
  const elsewhere = Object.keys(NOT_SHOWN).length;
  console.log(
    `\ntrace: ${traced.length} of ${proof.epic.size} E4 IDs show on a state; ${elsewhere} are proven elsewhere`,
  );
  for (const [id, titles] of traced) console.log(`  ${id}: ${[...new Set(titles)].join(" | ")}`);
  for (const [id, why] of Object.entries(NOT_SHOWN)) console.log(`  ${id}: (elsewhere) ${why}`);

  if (findings.length === 0) {
    console.log("\ndesign proof: OK");
    return 0;
  }

  console.log(`\ndesign proof: ${findings.length} findings. Fix each in Doop, then run it again.`);
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

  // Fetch in parallel, check in order, so the report has one order.
  const frames = await Promise.all(
    FRAMES.map(async (f) => ({ f, parsed: await loadFrame(f, key) })),
  );
  for (const { f, parsed } of frames) if (parsed !== undefined) checkFrame(proof, f, parsed);

  checkTrace(proof);
  checkF1(proof);
  checkRevs(proof);
  return printReport(proof);
};

process.exit(await main());

export {};
