import { resource } from "@tinkered/core";
import type { Node } from "oxc-parser";

export type Text = { text: string; at: number };

export type Places = {
  classes: Text[];
  styles: Text[];
  paints: Text[];
  built: Text[];
  scripts: Text[];
};

type Mode = "attribute" | "clsx";

export type Visitor = Record<
  "VariableDeclaration" | "JSXAttribute" | "CallExpression" | "AssignmentExpression",
  (node: Node) => void
>;

type Step = [Node, Mode];

type Form = (node: Node, mode: Mode) => void;

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
  begin: (text: string) => void;
  visitor: Visitor;
  end: () => Places;
};

export const placeWalk = resource({
  label: "kit.placeWalk",
  target: "scope",
  factory: () => {
    const sinks = new Set(["cn", "clsx", "cva"]);
    const classNames = new Set(["className", "class"]);
    const paintNames = new Set(["fill", "stroke", "stopColor", "stop-color"]);
    const classListWrites = new Set(["add", "remove", "toggle", "replace"]);

    let source = "";
    let places: Places = { classes: [], styles: [], paints: [], built: [], scripts: [] };
    const consts = new Map<string, Node>();
    const readConsts = new Set<string>();
    const readCalls = new Set<number>();
    const steps: Step[] = [];

    const wrappers = new Set<string>([
      "ParenthesizedExpression",
      "TSAsExpression",
      "TSSatisfiesExpression",
      "TSNonNullExpression",
      "JSXExpressionContainer",
    ]);

    const starts: Node[] = [];

    const walk: Walk = {
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

      whole: (node: Node): Text | null => {
        if (node.type === "Literal" && typeof node.value === "string") {
          return { text: source.slice(node.start + 1, node.end - 1), at: node.start + 1 };
        }
        const quasi = node.type === "TemplateLiteral" && !node.expressions.length && node.quasis[0];
        return quasi ? { text: source.slice(quasi.start, quasi.end), at: quasi.start } : null;
      },

      sinkName: (node: Node) => {
        const name =
          node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name;
        return name && sinks.has(name) ? name : null;
      },

      keyName: (prop: Node) => {
        if (prop.type !== "Property" || prop.computed) return undefined;
        return prop.key.type === "Identifier" ? prop.key.name : walk.whole(prop.key)?.text;
      },

      valueOf: (prop: Node) => (prop.type === "Property" ? walk.bare(prop.value) : null),

      propsOf: (node: Node | null) => {
        const object = node ? walk.bare(node) : null;
        return object?.type === "ObjectExpression" ? object.properties : [];
      },

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

      sinkCall: (node: Node) => {
        const name = walk.sinkName(node);
        if (node.type !== "CallExpression" || !name) return false;
        if (readCalls.has(node.start)) return true;

        readCalls.add(node.start);
        if (name === "cva") walk.cvaCall(node.arguments);
        else for (const arg of node.arguments) steps.push([arg, "clsx"]);
        return true;
      },

      named: (name: string, node: Node) => {
        const init = consts.get(name);
        if (name === "className" || name === "undefined" || readConsts.has(name)) return;
        if (!init) return walk.built(node);

        readConsts.add(name);
        const value = walk.bare(init);
        if (value.type !== "ObjectExpression") return void steps.push([value, "attribute"]);
        for (const prop of value.properties) {
          if (prop.type === "Property") steps.push([prop.value, "attribute"]);
          else walk.built(prop);
        }
      },

      keyPlace: (prop: Node, mode: Mode) => {
        const key = prop.type === "Property" && !prop.computed ? prop.key : null;
        if (!key) return walk.built(prop.type === "Property" ? prop.key : prop);
        if (key.type === "Identifier") {
          return void places.classes.push({ text: key.name, at: key.start });
        }
        steps.push([key, mode]);
      },

      keys: (node: Node, mode: Mode) => {
        if (node.type !== "ObjectExpression" || mode !== "clsx") return walk.built(node);
        for (const prop of node.properties) walk.keyPlace(prop, mode);
      },

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

      call: (node: Node) => {
        if (node.type !== "CallExpression" || walk.sinkCall(node)) return;
        const made = node.callee.type === "Identifier" ? consts.get(node.callee.name) : undefined;
        const cva = made ? walk.bare(made) : null;
        if (cva && walk.sinkName(cva) === "cva") walk.sinkCall(cva);
        else walk.built(node);
      },

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
        Property: (node, mode) => void (node.type === "Property" && steps.push([node.value, mode])),
        ObjectExpression: (node, mode) => walk.keys(node, mode),
        MemberExpression: (node) => walk.member(node),
        CallExpression: (node) => walk.call(node),
      },

      place: ([raw, mode]: Step) => {
        const node = walk.bare(raw);
        const text = walk.whole(node);
        const nothing =
          node.type === "Literal" && (node.value === null || typeof node.value === "boolean");
        if (text) places.classes.push(text);
        else if (!nothing) (walk.forms[node.type] ?? walk.built)(node, mode);
      },

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

      attribute: (node: Node) => {
        if (node.type !== "JSXAttribute" || !node.value) return;
        if (node.name.type !== "JSXIdentifier") return;
        const name = node.name.name;
        if (classNames.has(name)) steps.push([node.value, "attribute"]);
        if (name === "style") walk.styleObject(node.value);

        const paint = paintNames.has(name) ? walk.whole(walk.bare(node.value)) : null;
        if (paint) places.paints.push(paint);
      },

      assignment: (node: Node) => {
        const left = node.type === "AssignmentExpression" ? node.left : null;
        if (left?.type !== "MemberExpression" || left.computed) return;
        if (left.property.type === "Identifier" && left.property.name === "className") {
          places.scripts.push({ text: "className", at: left.property.start });
        }
      },

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

      setAttributeCall: (node: Node) => {
        if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") return;
        const { property } = node.callee;
        const first = node.arguments[0];
        if (property.type !== "Identifier" || property.name !== "setAttribute" || !first) return;

        if (walk.whole(walk.bare(first))?.text === "class") {
          places.scripts.push({ text: "setAttribute", at: property.start });
        }
      },

      begin: (text: string) => {
        source = text;
        places = { classes: [], styles: [], paints: [], built: [], scripts: [] };

        consts.clear();
        readConsts.clear();
        readCalls.clear();
        starts.length = 0;
      },

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
