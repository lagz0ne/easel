import { operation, resource } from "@tinkered/core";
import { z } from "zod";

export type PartBody = { id: string; rev: number; html: string; css: string };

export type MainFound = { id: string; html: string; css: string };

export type CopyCount = { id: string; linked: number; edited: number };

export type Filled = { html: string; copies: CopyCount[]; linked: string[] };

type Attr = { name: string; raw: string | null; value: string | null; quote: string };

type Text = { kind: "text"; raw: string };

type El = {
  kind: "el";
  tag: string;
  name: string;
  attrs: Attr[];
  kids: Node[];
  start: number;
  end: number;
  inner: [number, number] | null;
  close: number | null;
  selfClose: boolean;
};

type Node = El | Text;

type Splice = { from: number; to: number; text: string };

type Parts = {
  revisions: ReadonlyMap<string, readonly PartBody[]>;
  now: ReadonlyMap<string, PartBody>;
};

const voidTags = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const rawTags = new Set([
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "noscript",
]);

const named = new Map([
  ["quot", '"'],
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["apos", "'"],
  ["nbsp", "\u00a0"],
]);

const entity = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;

const attribute =
  /[\t\n\f\r /]*([^\t\n\f\r />][^\t\n\f\r />=]*)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r >]*)))?/y;

const startTag = /<(\/?)([a-zA-Z][^\t\n\f\r />]*)/y;

const tagClose = /[\t\n\f\r ]*(\/?)>/y;

const copyKey = "data-doop-instance";
const mainKey = "data-doop-component";
const partKey = "data-doop-part";
const propKey = "data-doop-prop";
const slotKey = "data-doop-slot";
const revKey = "data-doop-rev";
const propsKey = "data-doop-props";
const overridesKey = "data-doop-overrides";
const cssKey = "data-doop-component-css";
const sourceKey = "data-doop-component-source";
const firstOwn = [copyKey, revKey, "data-doop-id"];
const notInCopy = new Set([propKey, "data-doop-slot-suggest", mainKey]);

const record = z.record(z.string(), z.unknown());

const override = z.object({
  attrs: z.record(z.string(), z.unknown()).optional(),
  hidden: z.unknown().optional(),
});

type Mode = { judge: boolean; parts: Parts; used: Set<string>; counts: Map<string, CopyCount> };

type Reading = { html: string; at: number; stack: El[]; root: El };

type Shaping = {
  body: PartBody;
  copy: El;
  mode: Mode;
  props: Record<string, unknown>;
  overrides: Record<string, unknown>;
  slots: Map<string, El>;
  targets: Set<string>;
};

type Rule = { gap: string; prelude: string; body: string };

type Styles = Map<string, El[]>;

export const copyWork = resource({
  label: "kit.copyWork",
  target: "scope",
  factory: () => {
    const trees = new Map<string, El>();

    return {
      decode(text: string): string {
        return text.replace(entity, (whole, code: string) => {
          const low = code.toLowerCase();
          if (low.startsWith("#x")) return String.fromCodePoint(Number.parseInt(low.slice(2), 16));
          if (low.startsWith("#")) return String.fromCodePoint(Number.parseInt(low.slice(1), 10));
          return named.get(low) ?? whole;
        });
      },

      escape(value: string): string {
        return value
          .replaceAll("&", "&amp;")
          .replaceAll('"', "&quot;")
          .replaceAll("\u00a0", "&nbsp;");
      },

      element(tag: string, start: number): El {
        return {
          kind: "el",
          tag,
          name: tag.toLowerCase(),
          attrs: [],
          kids: [],
          start,
          end: start,
          inner: null,
          close: null,
          selfClose: false,
        };
      },

      attrOf(found: RegExpExecArray): Attr {
        const raw = found[2] ?? found[3] ?? found[4] ?? null;
        const quote = found[2] !== undefined ? '"' : found[3] !== undefined ? "'" : "";
        const value = raw === null ? null : this.decode(raw);
        return { name: found[1] ?? "", raw, value, quote };
      },

      readAttrs(html: string, at: number): { attrs: Attr[]; end: number; selfClose: boolean } {
        const attrs: Attr[] = [];
        let end = at;
        attribute.lastIndex = at;
        for (let found = attribute.exec(html); found; found = attribute.exec(html)) {
          if (found[0].length === 0) break;
          attrs.push(this.attrOf(found));
          end = attribute.lastIndex;
        }

        tagClose.lastIndex = end;
        const closed = tagClose.exec(html);
        return { attrs, end: closed ? tagClose.lastIndex : end, selfClose: closed?.[1] === "/" };
      },

      top(reading: Reading): El {
        return reading.stack[reading.stack.length - 1] ?? reading.root;
      },

      text(reading: Reading, to: number): void {
        if (to > reading.at) {
          this.top(reading).kids.push({ kind: "text", raw: reading.html.slice(reading.at, to) });
        }
      },

      comment(reading: Reading, lt: number): number {
        const { html } = reading;
        const stop = html.startsWith("<!--", lt) ? html.indexOf("-->", lt + 4) : -1;
        const to = stop !== -1 ? stop + 3 : html.indexOf(">", lt) + 1 || html.length;

        this.text(reading, lt);
        this.top(reading).kids.push({ kind: "text", raw: html.slice(lt, to) });
        return to;
      },

      closeTag(reading: Reading, lt: number, name: string): number {
        const { html, stack } = reading;
        const to = html.indexOf(">", lt) + 1 || html.length;
        const open = stack.findLastIndex((el) => el.name === name);
        if (open <= 0) return to;

        for (const el of stack.slice(open)) el.end = to;
        const closing = stack[open];
        if (closing) closing.close = lt;
        stack.length = open;
        return to;
      },

      rawEnd(reading: Reading, el: El, name: string): number {
        const { html } = reading;
        const ends = new RegExp(`</${name}[\\t\\n\\f\\r />]`, "gi");
        ends.lastIndex = el.end;
        const stop = ends.exec(html)?.index ?? html.length;
        el.inner = [el.end, stop];
        if (stop > el.end) el.kids.push({ kind: "text", raw: html.slice(el.end, stop) });

        el.close = stop;
        el.end = html.indexOf(">", stop) + 1 || html.length;
        return el.end;
      },

      openTag(reading: Reading, lt: number, tag: string): number {
        const el = this.element(tag, lt);
        const read = this.readAttrs(reading.html, startTag.lastIndex);
        el.attrs = read.attrs;
        el.selfClose = read.selfClose;
        el.end = read.end;
        this.top(reading).kids.push(el);

        if (voidTags.has(el.name) || read.selfClose) return read.end;
        if (rawTags.has(el.name)) return this.rawEnd(reading, el, el.name);
        reading.stack.push(el);
        return read.end;
      },

      step(reading: Reading): number {
        const { html } = reading;
        const lt = html.indexOf("<", reading.at);
        if (lt === -1) return html.length;
        if (html.startsWith("<!--", lt) || /^<[!?]/.test(html.slice(lt, lt + 2))) {
          return this.comment(reading, lt);
        }

        startTag.lastIndex = lt;
        const tag = startTag.exec(html);
        if (!tag) {
          this.text(reading, lt + 1);
          return lt + 1;
        }

        this.text(reading, lt);
        const name = tag[2] ?? "";
        if (tag[1] === "/") return this.closeTag(reading, lt, name.toLowerCase());
        return this.openTag(reading, lt, name);
      },

      parse(html: string): El {
        const root = this.element("#root", 0);
        root.end = html.length;
        const reading: Reading = { html, at: 0, stack: [root], root };
        while (reading.at < html.length) reading.at = this.step(reading);
        return root;
      },

      treeOf(html: string): El {
        const kept = trees.get(html);
        if (kept) return kept;
        if (trees.size > 400) trees.clear();

        const made = this.parse(html);
        trees.set(html, made);
        return made;
      },

      attr(el: El, name: string): string | null {
        return el.attrs.find((a) => a.name.toLowerCase() === name)?.value ?? null;
      },

      isCopy(el: El): boolean {
        return el.name !== "style" && this.attr(el, copyKey) !== null;
      },

      serialize(node: Node): string {
        if (node.kind === "text") return node.raw;

        const attrs = node.attrs
          .map((a) => (a.raw === null ? ` ${a.name}` : ` ${a.name}=${a.quote}${a.raw}${a.quote}`))
          .join("");
        const open = `<${node.tag}${attrs}${node.selfClose ? "/" : ""}>`;
        if (voidTags.has(node.name) || node.selfClose) return open;
        return `${open}${node.kids.map((kid) => this.serialize(kid)).join("")}</${node.tag}>`;
      },

      setAttr(attrs: Attr[], name: string, value: string): Attr[] {
        const made = { name, raw: this.escape(value), value, quote: '"' };
        const at = attrs.findIndex((a) => a.name.toLowerCase() === name.toLowerCase());
        return at === -1 ? [...attrs, made] : attrs.map((a, i) => (i === at ? made : a));
      },

      json(el: El, name: string): Record<string, unknown> {
        const text = this.attr(el, name);
        if (text === null) return {};
        try {
          const parsed: unknown = JSON.parse(text);
          return record.safeParse(parsed).data ?? {};
        } catch {
          return {};
        }
      },

      slotsOf(el: El, found = new Map<string, El>()): Map<string, El> {
        for (const kid of el.kids) {
          if (kid.kind !== "el") continue;
          const slot = this.attr(kid, slotKey);
          if (slot !== null && !found.has(slot)) found.set(slot, kid);
          if (slot === null && !this.isCopy(kid)) this.slotsOf(kid, found);
        }
        return found;
      },

      propTargets(el: El, found = new Set<string>()): Set<string> {
        const prop = this.attr(el, propKey);
        if (prop !== null) found.add(prop);
        for (const kid of el.kids) {
          if (kid.kind === "el" && !this.isCopy(kid)) this.propTargets(kid, found);
        }
        return found;
      },

      mainOf(body: PartBody): El | undefined {
        return this.treeOf(body.html).kids.find((kid): kid is El => kid.kind === "el");
      },

      count(mode: Mode, id: string, linked: boolean): void {
        const now = mode.counts.get(id) ?? { id, linked: 0, edited: 0 };
        const more = linked ? { linked: now.linked + 1 } : { edited: now.edited + 1 };
        mode.counts.set(id, { ...now, ...more });
      },

      build(main: El, body: PartBody, copy: El, mode: Mode): El {
        const shaping: Shaping = {
          body,
          copy,
          mode,
          props: this.json(copy, propsKey),
          overrides: this.json(copy, overridesKey),
          slots: this.slotsOf(copy),
          targets: this.propTargets(main),
        };
        return this.shape(main, true, shaping) ?? copy;
      },

      ownAttrs(el: El, root: boolean, own: z.infer<typeof override> | undefined): Attr[] {
        let attrs = el.attrs.filter((a) => {
          const name = a.name.toLowerCase();
          return !notInCopy.has(name) && !(root && name === partKey);
        });
        for (const [name, value] of Object.entries(own?.attrs ?? {})) {
          if (typeof value === "string") attrs = this.setAttr(attrs, name, value);
        }
        return attrs;
      },

      shapeKid(kid: Node, shaping: Shaping): Node[] {
        if (kid.kind !== "el") return [kid];
        if (this.isCopy(kid)) return [this.nested(kid, shaping.mode)];

        const made = this.shape(kid, false, shaping);
        return made ? [made] : [];
      },

      shapeKids(el: El, shaping: Shaping): Node[] {
        const prop = this.attr(el, propKey);
        const slot = this.attr(el, slotKey);
        const given = prop === null ? undefined : shaping.props[prop];
        if (typeof given === "string") {
          return [{ kind: "text", raw: given.replaceAll("\u00a0", "&nbsp;") }];
        }

        const filled = slot === null ? undefined : shaping.slots.get(slot);
        if (filled) return filled.kids.map((kid) => this.slotKid(kid, shaping.mode));
        return el.kids.flatMap((kid) => this.shapeKid(kid, shaping));
      },

      shape(el: El, root: boolean, shaping: Shaping): El | null {
        const part = this.attr(el, partKey);
        const own = override.safeParse(part === null ? undefined : shaping.overrides[part]).data;
        if (own?.hidden === true) return null;

        const attrs = this.ownAttrs(el, root, own);
        const kids = this.shapeKids(el, shaping);
        const shaped = root ? this.rootAttrs(attrs, el, shaping) : attrs;
        return { ...el, attrs: shaped, kids, start: -1, end: -1 };
      },

      copyOwn(attrs: Attr[], main: El, shaping: Shaping): Attr[] {
        const taken = new Set([...main.attrs, ...attrs].map((a) => a.name.toLowerCase()));
        const own = shaping.copy.attrs.filter((a) => {
          const name = a.name.toLowerCase();
          return !taken.has(name) && name !== propsKey && name !== overridesKey;
        });
        const rev = String(shaping.body.rev);
        return [
          ...firstOwn.flatMap((name) => own.filter((a) => a.name.toLowerCase() === name)),
          ...own.filter((a) => !firstOwn.includes(a.name.toLowerCase())),
        ].map((a) =>
          a.name.toLowerCase() === revKey ? { ...a, raw: rev, value: rev, quote: '"' } : a,
        );
      },

      rootAttrs(attrs: Attr[], main: El, shaping: Shaping): Attr[] {
        let out = [...attrs, ...this.copyOwn(attrs, main, shaping)];
        for (const [name, value] of Object.entries(shaping.props)) {
          if (shaping.targets.has(name) || typeof value !== "string") continue;
          out = this.setAttr(out, `data-${name}`, value);
        }

        for (const name of [propsKey, overridesKey]) {
          const kept = shaping.copy.attrs.find((a) => a.name.toLowerCase() === name);
          if (kept) out = [...out, kept];
        }
        return out;
      },

      partFor(copy: El, mode: Mode): { id: string; body: PartBody; main: El } | null {
        const id = this.attr(copy, copyKey) ?? "";
        const body = mode.parts.now.get(id);
        const main = body && this.mainOf(body);
        return body && main ? { id, body, main } : null;
      },

      nested(copy: El, mode: Mode): Node {
        const part = mode.judge ? null : this.partFor(copy, mode);
        if (part === null) return copy;

        mode.used.add(part.id);
        return this.build(part.main, part.body, copy, mode);
      },

      slotKid(kid: Node, mode: Mode): Node {
        if (mode.judge || kid.kind !== "el") return kid;
        if (this.isCopy(kid)) return this.fillCopy(kid, mode);
        return { ...kid, kids: kid.kids.map((inner) => this.slotKid(inner, mode)) };
      },

      textOf(nodes: readonly Node[]): string {
        return this.decode(nodes.map((n) => (n.kind === "text" ? n.raw : "")).join(""));
      },

      sameText(want: Node, have: Node): boolean {
        if (want.kind !== "text" || have.kind !== "text") return false;
        return this.decode(want.raw) === this.decode(have.raw);
      },

      attrValues(el: El): Map<string, string> {
        return new Map(
          el.attrs
            .filter((a) => a.name.toLowerCase() !== revKey)
            .map((a) => [a.name.toLowerCase(), a.value ?? ""]),
        );
      },

      sameAttrs(want: El, have: El): boolean {
        const a = this.attrValues(want);
        const b = this.attrValues(have);
        return a.size === b.size && [...a].every(([name, value]) => b.get(name) === value);
      },

      liveKids(el: El): Node[] {
        return el.kids.filter((kid) => kid.kind === "el" || kid.raw !== "");
      },

      sameKids(want: El, have: El): boolean {
        const wantKids = this.liveKids(want);
        const haveKids = this.liveKids(have);
        const texts = [...wantKids, ...haveKids].every((k) => k.kind === "text");
        if (texts) return this.textOf(wantKids) === this.textOf(haveKids);

        return (
          wantKids.length === haveKids.length &&
          wantKids.every((kid, i) => {
            const other = haveKids[i];
            return other !== undefined && this.same(kid, other);
          })
        );
      },

      sameEl(want: El, have: El, top: boolean): boolean {
        if (want.name !== have.name) return false;
        if (!top && this.isCopy(want)) {
          return this.isCopy(have) && this.attr(want, copyKey) === this.attr(have, copyKey);
        }
        return this.sameAttrs(want, have) && this.sameKids(want, have);
      },

      same(want: Node, have: Node, top = false): boolean {
        if (want === have) return true;
        if (want.kind === "text" || have.kind === "text") return this.sameText(want, have);
        return this.sameEl(want, have, top);
      },

      linkedTo(copy: El, mode: Mode): boolean {
        const id = this.attr(copy, copyKey) ?? "";
        const judge = { ...mode, judge: true };
        return (mode.parts.revisions.get(id) ?? []).some((body) => {
          const main = this.mainOf(body);
          return main !== undefined && this.same(this.build(main, body, copy, judge), copy, true);
        });
      },

      fillCopy(copy: El, mode: Mode): Node {
        const part = this.partFor(copy, mode);
        if (part === null) return copy;

        const whole = copy.close !== null || copy.selfClose || voidTags.has(copy.name);
        const linked = whole && this.linkedTo(copy, mode);
        this.count(mode, part.id, linked);
        if (!linked) return copy;

        mode.used.add(part.id);
        return this.build(part.main, part.body, copy, mode);
      },

      walk(el: El, mode: Mode, splices: Splice[], styles: Styles): void {
        for (const kid of el.kids) {
          if (kid.kind !== "el") continue;
          const css = kid.name === "style" ? this.attr(kid, cssKey) : null;
          if (css !== null) styles.set(css, [...(styles.get(css) ?? []), kid]);
          if (!this.isCopy(kid)) {
            this.walk(kid, mode, splices, styles);
            continue;
          }

          const made = this.fillCopy(kid, mode);
          if (made !== kid) {
            splices.push({ from: kid.start, to: kid.end, text: this.serialize(made) });
          }
        }
      },

      firstOf(el: El, test: (kid: El) => boolean): El | undefined {
        for (const kid of el.kids) {
          if (kid.kind !== "el") continue;
          if (test(kid)) return kid;
          const found = this.firstOf(kid, test);
          if (found) return found;
        }
        return undefined;
      },

      depthOf(c: string | undefined): number {
        if (c === "(" || c === "[" || c === "{") return 1;
        if (c === ")" || c === "]" || c === "}") return -1;
        return 0;
      },

      ruleEnd(css: string, open: number): number {
        let depth = 1;
        let close = open + 1;
        for (; close < css.length && depth > 0; close++) depth += this.depthOf(css[close]);
        return close;
      },

      topLevel(css: string): { rules: Rule[]; tail: string } {
        const rules: Rule[] = [];
        let at = 0;
        for (let open = css.indexOf("{", at); open !== -1; open = css.indexOf("{", at)) {
          const close = this.ruleEnd(css, open);
          const head = css.slice(at, open);
          const lead = /^\s*/.exec(head)?.[0] ?? "";
          rules.push({ gap: lead, prelude: head.slice(lead.length), body: css.slice(open, close) });
          at = close;
        }
        return { rules, tail: css.slice(at) };
      },

      splitList(list: string): string[] {
        const out: string[] = [];
        let depth = 0;
        let from = 0;
        for (let i = 0; i < list.length; i++) {
          depth += this.depthOf(list[i]);
          if (list[i] !== "," || depth !== 0) continue;
          out.push(list.slice(from, i).trim());
          from = i + 1;
        }

        out.push(list.slice(from).trim());
        return out.filter((one) => one !== "");
      },

      insertAt(selector: string): number {
        let depth = 0;
        for (let i = 0; i < selector.length; i++) {
          const c = selector[i] ?? "";
          depth += this.depthOf(c);
          if (depth === 0 && (c === ":" || /[\s>+~]/.test(c))) return i;
        }
        return selector.length;
      },

      scoped(css: string, id: string): string {
        const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1] ?? "");
        const rules = this.scopedRules(css, id);
        if (names.length === 0) return rules;

        const animation = new RegExp(`(?<![\\w-])(${names.join("|")})(?![\\w-])`, "g");
        return rules
          .replace(
            /(@keyframes\s+)([\w-]+)/g,
            (_, at: string, name: string) => `${at}${name}__${id}`,
          )
          .replace(
            /(animation(?:-name)?\s*:)([^;}]*)/g,
            (_, key: string, value: string) => `${key}${value.replace(animation, `$1__${id}`)}`,
          );
      },

      scopedRule(rule: Rule, id: string): string {
        const { gap, prelude, body } = rule;
        if (/^@(media|supports|container|layer)\b/.test(prelude)) {
          return `${gap}${prelude}{${this.scopedRules(body.slice(1, -1), id)}}`;
        }
        if (prelude.startsWith("@")) return `${gap}${prelude}${body}`;

        const where = `:where([${copyKey}="${id}"])`;
        const list = this.splitList(prelude)
          .flatMap((one) => {
            const cut = this.insertAt(one);
            return [`${where} ${one}`, `${one.slice(0, cut)}${where}${one.slice(cut)}`];
          })
          .join(", ");
        return `${gap}${list} ${body}`;
      },

      scopedRules(css: string, id: string): string {
        const { rules, tail } = this.topLevel(css);
        const out = rules.map((rule) => this.scopedRule(rule, id)).join("");
        return `${out}${tail.trim() === "" && tail !== "" ? "\n" : tail}`;
      },

      missingAt(html: string, root: El): number {
        const head = this.firstOf(root, (el) => el.name === "head");
        const firstCopy = this.firstOf(root, (el) => this.isCopy(el));
        return head?.close ?? firstCopy?.start ?? html.length;
      },

      styleOf(id: string, mode: Mode, styles: Styles): { splices: Splice[]; missing: string[] } {
        const body = mode.parts.now.get(id);
        if (!body) return { splices: [], missing: [] };

        const text = this.scoped(body.css, id);
        const blocks = styles.get(id) ?? [];
        if (blocks.length === 0) {
          return { splices: [], missing: [`<style ${cssKey}="${id}">${text}</style>`] };
        }
        const splices = blocks.flatMap((block) =>
          block.inner ? [{ from: block.inner[0], to: block.inner[1], text }] : [],
        );
        return { splices, missing: [] };
      },

      styleSplices(html: string, root: El, mode: Mode, styles: Styles): Splice[] {
        const each = [...mode.used].map((id) => this.styleOf(id, mode, styles));
        const splices = each.flatMap((one) => one.splices);
        const missing = each.flatMap((one) => one.missing);
        if (missing.length === 0) return splices;

        const at = this.missingAt(html, root);
        return [...splices, { from: at, to: at, text: missing.join("\n") }];
      },

      visitMains(el: El, root: El, html: string, found: MainFound[]): MainFound[] {
        for (const kid of el.kids) {
          if (kid.kind !== "el") continue;
          const id = kid.name === "style" ? null : this.attr(kid, mainKey);
          if (id === null) {
            this.visitMains(kid, root, html, found);
            continue;
          }

          const sheet = this.firstOf(
            root,
            (s) => s.name === "style" && this.attr(s, sourceKey) === id,
          );
          const css = sheet?.inner ? html.slice(sheet.inner[0], sheet.inner[1]) : "";
          found.push({ id, html: html.slice(kid.start, kid.end), css });
        }
        return found;
      },

      mains(html: string): MainFound[] {
        const root = this.parse(html);
        return this.visitMains(root, root, html, []);
      },

      visitRevs(el: El, found: Map<string, number>): Map<string, number> {
        for (const kid of el.kids) {
          if (kid.kind !== "el") continue;
          const id = this.isCopy(kid) ? this.attr(kid, copyKey) : null;
          const rev = Number(this.attr(kid, revKey) ?? 0);
          if (id !== null && Number.isSafeInteger(rev)) {
            found.set(id, Math.max(found.get(id) ?? 0, rev));
          }
          this.visitRevs(kid, found);
        }
        return found;
      },

      revs(html: string): Map<string, number> {
        return this.visitRevs(this.parse(html), new Map());
      },

      fill(html: string, parts: Parts): Filled {
        const root = this.parse(html);
        const mode: Mode = { judge: false, parts, used: new Set(), counts: new Map() };
        const splices: Splice[] = [];
        const styles: Styles = new Map();
        this.walk(root, mode, splices, styles);

        const all = [...splices, ...this.styleSplices(html, root, mode, styles)].sort(
          (a, b) => b.from - a.from,
        );
        let out = html;
        for (const s of all) out = out.slice(0, s.from) + s.text + out.slice(s.to);
        return { html: out, copies: [...mode.counts.values()], linked: [...mode.used].sort() };
      },
    };
  },
});

export const mainsOf = operation({
  label: "kit.mainsOf",
  input: z.string(),
  depends: { work: copyWork },
  run: ({ work }, { input }) => work.mains(input),
});

export const copyRevs = operation({
  label: "kit.copyRevs",
  input: z.string(),
  depends: { work: copyWork },
  run: ({ work }, { input }) => work.revs(input),
});

export const fillCopies = operation({
  label: "kit.fillCopies",
  input: z.object({
    html: z.string(),
    revisions: z.custom<ReadonlyMap<string, readonly PartBody[]>>((v) => v instanceof Map),
    now: z.custom<ReadonlyMap<string, PartBody>>((v) => v instanceof Map),
  }),
  depends: { work: copyWork },
  run: ({ work }, { input }) => work.fill(input.html, input),
});
