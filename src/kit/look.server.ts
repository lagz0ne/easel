import { operation } from "@tinkered/core";
import { z } from "zod";

import { fontFaces } from "./fonts.server";
import { alias, lookPaths, lookType, valueOf } from "./shape";

const { color, dimension } = valueOf;

export const dtcg = z.record(z.string(), z.unknown());

export type Dtcg = z.infer<typeof dtcg>;

type Found = { path: string[]; type: string | undefined; value: unknown };

export const lookTokens = operation({
  label: "kit.lookTokens",
  input: dtcg,
  run: (_, { input }) => {
    const found: Found[] = [];
    const node = z.record(z.string(), z.unknown());
    const stack: Array<{ path: string[]; at: Dtcg; type: string | undefined }> = [
      { path: [], at: input, type: undefined },
    ];

    for (let next = stack.pop(); next; next = stack.pop()) {
      const type = typeof next.at.$type === "string" ? next.at.$type : next.type;
      if ("$value" in next.at) {
        found.push({ path: next.path, type, value: next.at.$value });
        continue;
      }
      const children = Object.entries(next.at).filter(([key]) => !key.startsWith("$"));
      for (const [key, child] of children.reverse()) {
        const read = node.safeParse(child);
        if (!read.success) throw new Error(`look: ${[...next.path, key].join(".")} is no group`);
        stack.push({ path: [...next.path, key], at: read.data, type });
      }
    }
    return found;
  },
});

export const colorCss = operation({
  label: "kit.colorCss",
  input: color,
  run: (_, { input }) => {
    const alpha = input.alpha ?? 1;
    const bytes = [...input.components, alpha].map((unit) =>
      Math.round(Math.min(Math.max(unit, 0), 1) * 255)
        .toString(16)
        .padStart(2, "0"),
    );
    const rgb = input.hex ? input.hex.toLowerCase() : `#${bytes.slice(0, 3).join("")}`;
    return alpha === 1 ? rgb : `${rgb}${bytes.slice(3).join("")}`;
  },
});

export const lengthCss = operation({
  label: "kit.lengthCss",
  input: dimension,
  run: (_, { input }) => `${input.value}${input.unit}`,
});

export const shadowCss = operation({
  label: "kit.shadowCss",
  input: valueOf.shadow,
  depends: { lengthCss, colorCss },
  run: ({ lengthCss, colorCss }, { input }) =>
    [input]
      .flat()
      .map((layer) =>
        [
          layer.inset ? "inset" : "",
          ...[layer.offsetX, layer.offsetY, layer.blur, layer.spread].map((d) =>
            lengthCss.run({ input: d }),
          ),
          colorCss.run({ input: layer.color }),
        ]
          .filter(Boolean)
          .join(" "),
      )
      .join(", "),
});

export const fontCss = operation({
  label: "kit.fontCss",
  input: valueOf.fontFamily,
  run: (_, { input }) => {
    const generic = /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+)$/;
    return [input]
      .flat()
      .map((name) => (generic.test(name) || /^[\w-]+$/.test(name) ? name : `"${name}"`))
      .join(", ");
  },
});

export const valueCss = operation({
  label: "kit.valueCss",
  input: z.object({ path: z.array(z.string()), type: z.string().optional(), value: z.unknown() }),
  depends: { colorCss, lengthCss, fontCss, shadowCss },
  run: ({ colorCss, lengthCss, fontCss, shadowCss }, { input: { path, type, value } }) => {
    if (alias.safeParse(value).success) return null;

    const kind = lookType.safeParse(type);
    if (!kind.success) throw new Error(`look: ${path.join(".")} has no type that the kit knows`);

    switch (kind.data) {
      case "color":
        return colorCss.run({ input: valueOf.color.parse(value) });
      case "dimension":
        return lengthCss.run({ input: valueOf.dimension.parse(value) });
      case "fontFamily":
        return fontCss.run({ input: valueOf.fontFamily.parse(value) });
      case "shadow":
        return shadowCss.run({ input: valueOf.shadow.parse(value) });
    }
  },
});

export const resolveAlias = operation({
  label: "kit.resolveAlias",
  input: z.custom<{ token: Found; byPath: Map<string, Found> }>(),
  run: (_, { input: { token, byPath } }) => {
    let target = token;
    for (let hops = 0; hops < 10; hops++) {
      const named = alias.safeParse(target.value);
      if (!named.success) return target;

      const to = byPath.get(named.data.slice(1, -1));
      if (!to) {
        throw new Error(`look: ${token.path.join(".")} names ${named.data}, not in the look`);
      }
      target = { ...to, type: to.type ?? token.type };
    }
    return target;
  },
});

export const lookValues = operation({
  label: "kit.lookValues",
  input: dtcg,
  depends: { lookTokens, resolveAlias, valueCss },
  run: ({ lookTokens, resolveAlias, valueCss }, { input }) => {
    const tokens = lookTokens.run({ input });
    const byPath = new Map(tokens.map((token) => [token.path.join("."), token]));
    const values: Record<string, string> = {};

    for (const token of tokens) {
      const name = `--${(token.path[0] === "color" ? token.path.slice(1) : token.path).join("-")}`;
      if (!/^--[a-z][a-z0-9-]*$/.test(name)) throw new Error(`look: ${name} is no CSS name`);

      const css = valueCss.run({ input: resolveAlias.run({ input: { token, byPath } }) });
      if (css === null) throw new Error(`look: ${token.path.join(".")} is an alias loop`);
      values[name] = css;
    }
    return values;
  },
});

export const rootBlock = operation({
  label: "kit.rootBlock",
  input: z.record(z.string(), z.string()),
  depends: { fontFaces },
  run: ({ fontFaces }, { input }) =>
    `${fontFaces.run({ input })}:root {\n${Object.entries(input)
      .map(([name, value]) => `  ${name}: ${value};\n`)
      .join("")}}\n`,
});

const asNode = z.record(z.string(), z.unknown()).catch({});

export const mergeLook = operation({
  label: "kit.mergeLook",
  input: z.object({ look: dtcg, patch: dtcg }),
  run: (_, { input: { look, patch } }) => {
    const merged: Dtcg = { ...look };
    for (const { path } of lookPaths) {
      const [first = "", second] = path.split(".");
      const group = asNode.parse(merged[first]);
      const given = asNode.parse(second ? asNode.parse(patch[first])[second] : patch[first]);
      if (!("$value" in given)) continue;

      merged[first] = second
        ? { ...group, [second]: { ...asNode.parse(group[second]), $value: given.$value } }
        : { ...group, $value: given.$value };
    }
    return merged;
  },
});
