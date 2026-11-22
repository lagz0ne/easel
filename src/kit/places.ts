import { resource } from "@tinkered/core";
import type { Node } from "oxc-parser";

// The places of an app frame that the kit check reads (SPEC-kit.md § App frames, "Class places";
// fact rule 9, judged rule 14). The walk reads the ESTree nodes of oxc-parser, which `placesOf`
// (`oxc.server.ts`) gives to its visitor: the server check (`app.server.ts`) and the Oxlint rule
// (`lint.server.ts`) both run it. So this file imports no parser and no server module. Each kind of
// place has its own reader; the visible texts of E9 are one more reader, with no change to the walk.

/** A text of the source and the offset where it starts (as `Part` of scan.server.ts). */
export type Text = { text: string; at: number };

/** What the walk found: the texts of each kind of place, and the findings of the shape. */
export type Places = {
  /** Each whole string of a class place. */
  classes: Text[];
  /** Each declaration of a `style` object with a string value (`color: #f00`), at the value. */
  styles: Text[];
  /** Each string `fill`, `stroke` or `stopColor`. */
  paints: Text[];
  /** Each expression in a class place that is not a whole name (`kit/class-built`), as written. */
  built: Text[];
  /** Each write of a class from code (`kit/script`): `text` names the write. */
  scripts: Text[];
};

/** How a place reads an object: in `cn` and `clsx` its keys are class names; elsewhere it is built. */
type Mode = "attribute" | "clsx";

/** The visitor of the walk: what it reads, by the type of the node. */
export type Visitor = Record<
  "VariableDeclaration" | "JSXAttribute" | "CallExpression" | "AssignmentExpression",
  (node: Node) => void
>;

/** One step of the walk of the class places: an expression and how to read it. */
type Step = [Node, Mode];

/** A form of a class place: how to read a node of one type. */
type Form = (node: Node, mode: Mode) => void;

/** The readers of the walk; each one reads the state of one read (see `placeWalk`). */
type Walk = {
  bare: (node: Node) => Node;
  built: (node: Node) => void;
  whole: (node: Node) => Text | null;
  sinkName: (node: Node) => string | null;
  keyName: (prop: Node) => string | undefined;
  valueOf: (prop: Node) => Node | null;
  propsOf: (node: Node | null) => Node[];
  cvaConfig: (raw: Node) => void;
  variants: (value: Node) => void;
  compounds: (value: Node) => void;
  cvaCall: (args: Node[]) => void;
  sinkCall: (node: Node) => boolean;
  named: (name: string, node: Node) => void;
  keyPlace: (prop: Node, mode: Mode) => void;
  keys: (node: Node, mode: Mode) => void;
  member: (node: Node) => void;
  call: (node: Node) => void;
  forms: Partial<Record<Node["type"], Form>>;
  place: (step: Step) => void;
  styleObject: (value: Node) => void;
  attribute: (node: Node) => void;
  assignment: (node: Node) => void;
  classListCall: (node: Node) => void;
  setAttributeCall: (node: Node) => void;
  /** Starts a read of a source: the visitor then gets each node of its program. */
  begin: (text: string) => void;
  visitor: Visitor;
  /** The places of the source that the visitor read. */
  end: () => Places;
};

/**
 * The walk. A resource, not an operation: its readers run for each node of a program, and a span
 * for each one would cost more than the read. A read is sync, so the state of one read is kept
 * here, and the next read starts it again.
 */
export const placeWalk = resource({
  label: "kit.placeWalk",
  target: "scope",
  factory: () => {
    /** The functions whose arguments are class places, and the attributes of each kind. */
    const sinks = new Set(["cn", "clsx", "cva"]);
    const classNames = new Set(["className", "class"]);
    const paintNames = new Set(["fill", "stroke", "stopColor", "stop-color"]);
    const classListWrites = new Set(["add", "remove", "toggle", "replace"]);

    let source = "";
    let places: Places = { classes: [], styles: [], paints: [], built: [], scripts: [] };
    /** Each `const` of the file by name (not by scope: a known limit), and those read. */
    const consts = new Map<string, Node>();
    const readConsts = new Set<string>();
    const readCalls = new Set<number>();
    const steps: Step[] = [];

    /** The nodes that wrap an expression and change nothing: parentheses, TypeScript, JSX `{}`. */
    const wrappers = new Set<string>([
      "ParenthesizedExpression",
      "TSAsExpression",
      "TSSatisfiesExpression",
      "TSNonNullExpression",
      "JSXExpressionContainer",
    ]);

    /** The nodes where a place can start, in the order of the source; read at the end. */
    const starts: Node[] = [];

    const walk: Walk = {
      /** An expression with no wrapper around it. (An arrow's `expression` is a boolean.) */
      bare: (node: Node): Node => {
        const inner = wrappers.has(node.type) && "expression" in node ? node.expression : null;
        return inner && typeof inner === "object" ? walk.bare(inner) : node;
      },

      built: (node: Node) => {
        const text = source.slice(node.start, node.end).replace(/\s+/g, " ");
        places.built.push({
          text: text.length > 60 ? `${text.slice(0, 57)}...` : text,
          at: node.start,
        });
      },

      /** A string or a template with no value: its text as written, after its quote. */
      whole: (node: Node): Text | null => {
        if (node.type === "Literal" && typeof node.value === "string") {
          return { text: source.slice(node.start + 1, node.end - 1), at: node.start + 1 };
        }
        const quasi = node.type === "TemplateLiteral" && !node.expressions.length && node.quasis[0];
        return quasi ? { text: source.slice(quasi.start, quasi.end), at: quasi.start } : null;
      },

      /** The name of `cn`, `clsx` or `cva` when a call names one of them. */
      sinkName: (node: Node) => {
        const name =
          node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name;
        return name && sinks.has(name) ? name : null;
      },

      /** The key of a property that is not computed: a name or a string. */
      keyName: (prop: Node) => {
        if (prop.type !== "Property" || prop.computed) return undefined;
        return prop.key.type === "Identifier" ? prop.key.name : walk.whole(prop.key)?.text;
      },

      valueOf: (prop: Node) => (prop.type === "Property" ? walk.bare(prop.value) : null),

      /** The properties of an object, with no wrapper around it; none for another node. */
      propsOf: (node: Node | null) => {
        const object = node ? walk.bare(node) : null;
        return object?.type === "ObjectExpression" ? object.properties : [];
      },

      /** `cva(base, config)`: each value of each variant, and the class of each compound variant. */
      cvaConfig: (raw: Node) => {
        const config = walk.bare(raw);
        if (config.type !== "ObjectExpression") return walk.built(config);

        for (const prop of config.properties) {
          const key = walk.keyName(prop);
          const value = walk.valueOf(prop);
          if (value && key === "variants") walk.variants(value);
          if (value && key === "compoundVariants") walk.compounds(value);
        }
      },

      variants: (value: Node) => {
        if (value.type !== "ObjectExpression") return walk.built(value);

        for (const variant of value.properties) {
          const options = walk.valueOf(variant) ?? variant;
          if (options.type !== "ObjectExpression") walk.built(options);
          else for (const option of options.properties) steps.push([option, "clsx"]);
        }
      },

      compounds: (value: Node) => {
        if (value.type !== "ArrayExpression") return walk.built(value);

        for (const item of value.elements) {
          for (const field of walk.propsOf(item)) {
            const key = walk.keyName(field);
            const place = walk.valueOf(field);
            if (key && place && classNames.has(key)) steps.push([place, "clsx"]);
          }
        }
      },

      cvaCall: (args: Node[]) => {
        const [base, config, ...rest] = args;
        if (base) steps.push([base, "clsx"]);
        if (config) walk.cvaConfig(config);
        for (const arg of rest) walk.built(arg);
      },

      /** The arguments of a call of `cn`, `clsx` or `cva`, one time for each call. */
      sinkCall: (node: Node) => {
        const name = walk.sinkName(node);
        if (node.type !== "CallExpression" || !name) return false;
        if (readCalls.has(node.start)) return true;

        readCalls.add(node.start);
        if (name === "cva") walk.cvaCall(node.arguments);
        else for (const arg of node.arguments) steps.push([arg, "clsx"]);
        return true;
      },

      /** A name in a class place: `className` passes on; a const is read where it is declared. */
      named: (name: string, node: Node) => {
        const init = consts.get(name);
        if (name === "className" || name === "undefined" || readConsts.has(name)) return;
        if (!init) return walk.built(node);

        readConsts.add(name);
        const value = walk.bare(init);
        if (value.type !== "ObjectExpression") return void steps.push([value, "attribute"]);
        // A map of whole names: each value is a place.
        for (const prop of value.properties) {
          if (prop.type === "Property") steps.push([prop.value, "attribute"]);
          else walk.built(prop);
        }
      },

      /** One property of an object in `cn` or `clsx`: its key is a class name. */
      keyPlace: (prop: Node, mode: Mode) => {
        const key = prop.type === "Property" && !prop.computed ? prop.key : null;
        if (!key) return walk.built(prop.type === "Property" ? prop.key : prop);
        if (key.type === "Identifier") {
          return void places.classes.push({ text: key.name, at: key.start });
        }
        steps.push([key, mode]);
      },

      /** An object in `cn` or `clsx`: each key is a class name; its value is a condition. */
      keys: (node: Node, mode: Mode) => {
        if (node.type !== "ObjectExpression" || mode !== "clsx") return walk.built(node);
        for (const prop of node.properties) walk.keyPlace(prop, mode);
      },

      /** A member in a class place: a `className` passed on, or a map of whole names. */
      member: (node: Node) => {
        if (node.type !== "MemberExpression") return walk.built(node);
        const passed =
          !node.computed &&
          node.property.type === "Identifier" &&
          node.property.name === "className";
        if (passed) return;

        if (node.object.type === "Identifier" && consts.has(node.object.name)) {
          return walk.named(node.object.name, node);
        }
        walk.built(node);
      },

      /** A call in a class place: `cn`, `clsx`, `cva`, or a function that `cva` made. */
      call: (node: Node) => {
        if (node.type !== "CallExpression" || walk.sinkCall(node)) return;
        const made = node.callee.type === "Identifier" ? consts.get(node.callee.name) : undefined;
        const cva = made ? walk.bare(made) : null;
        if (cva && walk.sinkName(cva) === "cva") walk.sinkCall(cva);
        else walk.built(node);
      },

      /** The other forms of a class place, by the type of their node. */
      forms: {
        JSXEmptyExpression: () => undefined,
        Identifier: (node) => walk.named(node.type === "Identifier" ? node.name : "", node),
        LogicalExpression: (node, mode) => {
          if (node.type !== "LogicalExpression") return;
          if (node.operator !== "&&") steps.push([node.left, mode]);
          steps.push([node.right, mode]);
        },
        ConditionalExpression: (node, mode) => {
          if (node.type !== "ConditionalExpression") return;
          steps.push([node.consequent, mode], [node.alternate, mode]);
        },
        ArrayExpression: (node, mode) => {
          for (const item of node.type === "ArrayExpression" ? node.elements : []) {
            if (item) steps.push([item, mode]);
          }
        },
        // An option of a cva variant: its value is the place.
        Property: (node, mode) => void (node.type === "Property" && steps.push([node.value, mode])),
        ObjectExpression: (node, mode) => walk.keys(node, mode),
        MemberExpression: (node) => walk.member(node),
        CallExpression: (node) => walk.call(node),
      },

      /** One expression of a class place. */
      place: ([raw, mode]: Step) => {
        const node = walk.bare(raw);
        const text = walk.whole(node);
        const nothing =
          node.type === "Literal" && (node.value === null || typeof node.value === "boolean");
        if (text) places.classes.push(text);
        else if (!nothing) (walk.forms[node.type] ?? walk.built)(node, mode);
      },

      /** The declarations of `style` with a string value, as CSS: `marginTop` is `margin-top`. */
      styleObject: (value: Node) => {
        for (const prop of walk.propsOf(value)) {
          const key = walk.keyName(prop);
          const inner = walk.valueOf(prop);
          const text = inner ? walk.whole(inner) : null;
          if (!key || !text) continue;

          const name = key.startsWith("--")
            ? key
            : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
          places.styles.push({ text: `${name}: ${text.text}`, at: text.at });
        }
      },

      /** A JSX attribute: a class place, a `style` object, or a paint. */
      attribute: (node: Node) => {
        if (node.type !== "JSXAttribute" || !node.value) return;
        if (node.name.type !== "JSXIdentifier") return;
        const name = node.name.name;
        if (classNames.has(name)) steps.push([node.value, "attribute"]);
        if (name === "style") walk.styleObject(node.value);

        const paint = paintNames.has(name) ? walk.whole(walk.bare(node.value)) : null;
        if (paint) places.paints.push(paint);
      },

      /** An assignment to `className`. */
      assignment: (node: Node) => {
        const left = node.type === "AssignmentExpression" ? node.left : null;
        if (left?.type !== "MemberExpression" || left.computed) return;
        if (left.property.type === "Identifier" && left.property.name === "className") {
          places.scripts.push({ text: "className", at: left.property.start });
        }
      },

      /** A call of `classList.add`, `remove`, `toggle` or `replace`. */
      classListCall: (node: Node) => {
        if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") return;
        const { object, property } = node.callee;
        if (object.type !== "MemberExpression" || property.type !== "Identifier") return;

        const list = object.property;
        if (
          list.type === "Identifier" &&
          list.name === "classList" &&
          classListWrites.has(property.name)
        ) {
          places.scripts.push({ text: "classList", at: list.start });
        }
      },

      /** A call of `setAttribute("class", ...)`. */
      setAttributeCall: (node: Node) => {
        if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") return;
        const { property } = node.callee;
        const first = node.arguments[0];
        if (property.type !== "Identifier" || property.name !== "setAttribute" || !first) return;

        if (walk.whole(walk.bare(first))?.text === "class") {
          places.scripts.push({ text: "setAttribute", at: property.start });
        }
      },

      /** Starts a read of a source: the visitor then gets each node of its program. */
      begin: (text: string) => {
        source = text;
        places = { classes: [], styles: [], paints: [], built: [], scripts: [] };

        consts.clear();
        readConsts.clear();
        readCalls.clear();
        starts.length = 0;
      },

      /**
       * The visitor of the program, for the walk of a parser (oxc-parser's `Visitor`):
       * each `const` goes into `consts`, each node where a place can start into `starts`. A place
       * can name a `const` that comes later in the file, so the places are read at the end.
       */
      visitor: {
        VariableDeclaration: (node: Node) => {
          if (node.type !== "VariableDeclaration" || node.kind !== "const") return;
          for (const one of node.declarations) {
            if (one.id.type === "Identifier" && one.init) consts.set(one.id.name, one.init);
          }
        },
        JSXAttribute: (node: Node) => void starts.push(node),
        CallExpression: (node: Node) => void starts.push(node),
        AssignmentExpression: (node: Node) => void starts.push(node),
      },

      /** The places of the source that the visitor read. */
      end: (): Places => {
        for (const node of starts) {
          walk.attribute(node);
          walk.sinkCall(node);
          walk.assignment(node);
          walk.classListCall(node);
          walk.setAttributeCall(node);

          for (let step = steps.pop(); step; step = steps.pop()) walk.place(step);
        }
        return places;
      },
    };
    return walk;
  },
});
