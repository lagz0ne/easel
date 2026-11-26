import { operation } from "@tinkered/core";
import { z } from "zod";

import { lightDark } from "./compose";
import { fontFaces } from "./fonts.server";
import {
  alias,
  lookGroups,
  lookPaths,
  lookSet,
  lookType,
  resolutionOrder,
  resolverSchema,
  resolverVersion,
  themeModifier,
  valueOf,
} from "./shape";

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

export const contextValues = operation({
  label: "kit.contextValues",
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

const asNode = z.record(z.string(), z.unknown()).catch({});

const resolverLook = z.object({
  version: z.literal(resolverVersion),
  sets: z.object({ [lookSet]: z.object({ sources: z.tuple([dtcg]) }) }),
  modifiers: z.object({
    [themeModifier]: z.object({ contexts: z.object({ dark: z.array(dtcg) }) }),
  }),
});

export const lookParts = operation({
  label: "kit.lookParts",
  input: dtcg,
  run: (_, { input }) => {
    const read = resolverLook.safeParse(input);
    if (!read.success) return { light: input, dark: null, resolver: null };

    const [light] = read.data.sets[lookSet].sources;
    const dark = read.data.modifiers[themeModifier].contexts.dark[0] ?? null;
    return { light, dark, resolver: input };
  },
});

export const lookContexts = operation({
  label: "kit.lookContexts",
  input: dtcg,
  depends: { lookParts },
  run: ({ lookParts }, { input }) => {
    const { light, dark: source } = lookParts.run({ input });
    if (source === null) return { light, dark: null };

    const dark: Dtcg = { ...light };
    for (const [group, node] of Object.entries(source)) {
      dark[group] = { ...asNode.parse(dark[group]), ...asNode.parse(node) };
    }
    return { light, dark };
  },
});

export const lookValues = operation({
  label: "kit.lookValues",
  input: dtcg,
  depends: { lookContexts, contextValues },
  run: ({ lookContexts, contextValues }, { input }) => {
    const { light, dark } = lookContexts.run({ input });
    const lights = contextValues.run({ input: light });
    if (dark === null) return lights;

    const darks = contextValues.run({ input: dark });
    return Object.fromEntries(
      Object.entries(lights).map(([name, value]) => {
        const other = darks[name] ?? value;
        return [name, other === value ? value : `light-dark(${value}, ${other})`];
      }),
    );
  },
});

export const rootBlock = operation({
  label: "kit.rootBlock",
  input: z.record(z.string(), z.string()),
  depends: { fontFaces },
  run: ({ fontFaces }, { input }) => {
    const themed = Object.values(input).some((value) => lightDark.test(value));
    const scheme = themed ? "  color-scheme: light dark;\n" : "";
    return `${fontFaces.run({ input })}:root {\n${scheme}${Object.entries(input)
      .map(([name, value]) => `  ${name}: ${value};\n`)
      .join("")}}\n`;
  },
});

export const mergeTokens = operation({
  label: "kit.mergeTokens",
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

export const sameAsLight = operation({
  label: "kit.sameAsLight",
  input: z.object({
    name: z.string(),
    value: z.unknown(),
    lights: z.record(z.string(), z.string()),
  }),
  depends: { colorCss },
  run: ({ colorCss }, { input: { name, value, lights } }) => {
    const plain = color.safeParse(value);
    return plain.success && colorCss.run({ input: plain.data }) === lights[`--${name}`];
  },
});

export const darkOrNull = operation({
  label: "kit.darkOrNull",
  input: dtcg,
  run: (_, { input }) =>
    lookGroups.color.names.some((name) => name in input) ? { color: input } : null,
});

export const mergeDark = operation({
  label: "kit.mergeDark",
  input: z.object({ dark: dtcg.nullable(), patch: dtcg, lights: z.record(z.string(), z.string()) }),
  depends: { sameAsLight, darkOrNull },
  run: ({ sameAsLight, darkOrNull }, { input: { dark, patch, lights } }) => {
    const group: Dtcg = { $type: "color", ...asNode.parse(dark?.color) };
    const given = asNode.parse(patch.color);
    for (const name of lookGroups.color.names) {
      const entry = asNode.parse(given[name]);
      if (!("$value" in entry)) continue;

      const twin = { name, value: entry.$value, lights };
      if (!(name in group) && sameAsLight.run({ input: twin })) continue;

      const told = entry.$description ?? asNode.parse(group[name]).$description;
      group[name] =
        told === undefined
          ? { $value: entry.$value }
          : { $value: entry.$value, $description: told };
    }
    return darkOrNull.run({ input: group });
  },
});

const resolverParts = z.object({
  version: z.literal(resolverVersion),
  sets: z.object({ [lookSet]: z.object({ sources: z.tuple([dtcg]) }) }).optional(),
  modifiers: z
    .object({
      [themeModifier]: z.object({ contexts: z.object({ dark: z.array(dtcg).optional() }) }),
    })
    .optional(),
});

export const patchParts = operation({
  label: "kit.patchParts",
  input: dtcg,
  run: (_, { input }) => {
    const read = resolverParts.safeParse(input);
    if (!read.success) return { light: input, dark: null };

    const light = read.data.sets?.[lookSet].sources[0] ?? {};
    return { light, dark: read.data.modifiers?.[themeModifier].contexts.dark?.[0] ?? null };
  },
});

export const resolverDoc = operation({
  label: "kit.resolverDoc",
  input: z.object({ resolver: dtcg.nullable(), light: dtcg, dark: dtcg.nullable() }),
  run: (_, { input: { resolver, light, dark } }) => ({
    $schema: resolverSchema,
    ...resolver,
    version: resolverVersion,
    sets: { [lookSet]: { sources: [light] } },
    modifiers: {
      [themeModifier]: {
        contexts: { light: [], dark: dark === null ? [] : [dark] },
        default: "light",
      },
    },
    resolutionOrder,
  }),
});

export const mergeLook = operation({
  label: "kit.mergeLook",
  input: z.object({ look: dtcg, patch: dtcg }),
  depends: { lookParts, patchParts, mergeTokens, contextValues, mergeDark, resolverDoc },
  run: (units, { input: { look, patch } }) => {
    const now = units.lookParts.run({ input: look });
    const asked = units.patchParts.run({ input: patch });
    const light = units.mergeTokens.run({ input: { look: now.light, patch: asked.light } });
    const dark =
      asked.dark === null
        ? now.dark
        : units.mergeDark.run({
            input: {
              dark: now.dark,
              patch: asked.dark,
              lights: units.contextValues.run({ input: light }),
            },
          });
    if (now.resolver === null && dark === null) return light;

    return units.resolverDoc.run({ input: { resolver: now.resolver, light, dark } });
  },
});
