import { dirname, join, relative } from "node:path";

import { operation } from "@tinkered/core";
import type { Data } from "@tinkered/core";
import { z } from "zod";

import { deriveMap } from "./derive";
import { placeMap } from "./place";
import type { MapJson } from "./text";
import { cellShape } from "./units";
import { readView } from "./view";
import type { ViewState } from "./view";

const appImport = /^(\.|@\/)/;
const contractDepth = 4;
const scanner = new Bun.Transpiler({ loader: "tsx" });

type Module = Readonly<Record<string, unknown>>;

type Cell = { file: string; name: string; value: Data.Cell<unknown>; module: Module };

type Offered = {
  unit: unknown;
  name: string;
  file: string;
  reads: ViewState["actions"][number]["reads"];
};

type Offers =
  | { kind: "view"; states: Array<{ state: string; actions: Offered[] }> }
  | { kind: "all"; actions: unknown[] };

export type Derived = {
  map: MapJson;
  cell: { file: string; name: string; value: Data.Cell<unknown> };
  view: string | null;
  contracts: Array<Record<string, unknown>>;
  actions: Array<{ name: string; file: string; unit: unknown }>;
};

const module = z.custom<Module>();

export const fieldOf = operation({
  label: "map.fieldOf",
  input: z.object({ value: z.unknown(), key: z.string() }),
  run: (_, { input: { value, key } }): unknown =>
    (typeof value === "object" || typeof value === "function") && value !== null
      ? Reflect.get(value, key)
      : undefined,
});

export const filesOf = operation({
  label: "map.filesOf",
  input: z.object({ cwd: z.string(), pattern: z.string() }),
  run: async (_, { input }) => {
    const found: string[] = [];
    for await (const file of new Bun.Glob(input.pattern).scan({ cwd: input.cwd, absolute: true })) {
      found.push(file);
    }
    return found.sort();
  },
});

const loadModule = operation({
  label: "map.loadModule",
  input: z.string(),
  run: async (_, { input: file }): Promise<Module> => ({ ...(await import(file)) }),
});

const cellIn = operation({
  label: "map.cellIn",
  input: z.object({ file: z.string(), module, label: z.string() }),
  depends: { fieldOf },
  run: ({ fieldOf }, { input: { file, module, label } }): Cell | null => {
    for (const [name, value] of Object.entries(module)) {
      const cell = cellShape.safeParse(value);
      if (cell.success && fieldOf.run({ input: { value, key: "label" } }) === label) {
        return { file, name, value: cell.data, module };
      }
    }
    return null;
  },
});

const findCell = operation({
  label: "map.findCell",
  input: z.object({ src: z.string(), label: z.string() }),
  depends: { filesOf, loadModule, cellIn },
  run: async ({ filesOf, loadModule, cellIn }, { input: { src, label } }) => {
    for (const file of await filesOf.run({ input: { cwd: src, pattern: "**/*.ts" } })) {
      const named = (await Bun.file(file).text()).includes(`"${label}"`);
      if (!named || file.includes(".server.")) continue;

      const module = await loadModule.run({ input: file });
      const cell = cellIn.run({ input: { file, module, label } });
      if (cell) return cell;
    }
    return null;
  },
});

const findView = operation({
  label: "map.findView",
  input: z.object({ src: z.string(), cell: z.string() }),
  depends: { filesOf, readView },
  run: async ({ filesOf, readView }, { input: { src, cell } }) => {
    for (const file of await filesOf.run({ input: { cwd: src, pattern: "**/*.tsx" } })) {
      const source = await Bun.file(file).text();
      if (!source.includes(cell) || !source.includes("useData(")) continue;

      const view = readView.run({ input: { file, source, cell } });
      if (view.kind === "found") return { file, states: view.states };
    }
    return null;
  },
});

const resolveFrom = operation({
  label: "map.resolveFrom",
  input: z.object({ file: z.string(), specifier: z.string() }),
  run: (_, { input: { file, specifier } }) => {
    try {
      return Bun.resolveSync(specifier, dirname(file));
    } catch {
      return null;
    }
  },
});

const importsOf = operation({
  label: "map.importsOf",
  input: z.string(),
  depends: { resolveFrom },
  run: async ({ resolveFrom }, { input: file }) => {
    const imports = scanner.scanImports(await Bun.file(file).text());
    return imports.flatMap(({ path }) => {
      const target = appImport.test(path)
        ? resolveFrom.run({ input: { file, specifier: path } })
        : null;
      return target && /\.tsx?$/.test(target) ? [target] : [];
    });
  },
});

const contractsOf = operation({
  label: "map.contractsOf",
  input: module,
  depends: { fieldOf },
  run: ({ fieldOf }, { input: loaded }) =>
    Object.values(loaded).flatMap((value) => {
      const entries =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? Object.entries(value)
          : [];
      const isContract =
        entries.length > 0 &&
        entries.every(
          ([, member]) => fieldOf.run({ input: { value: member, key: "output" } }) !== undefined,
        );
      return isContract ? [Object.fromEntries(entries)] : [];
    }),
});

const contractsFrom = operation({
  label: "map.contractsFrom",
  input: z.object({ src: z.string(), files: z.array(z.string()) }),
  depends: { loadModule, contractsOf, importsOf },
  run: async ({ loadModule, contractsOf, importsOf }, { input: { src, files } }) => {
    const seen = new Set<string>();
    const contracts: Array<Record<string, unknown>> = [];
    let wave = [...files];
    for (let depth = 0; depth < contractDepth; depth += 1) {
      const open = wave.filter((file) => !seen.has(file) && file.startsWith(src));
      const app = open.filter((file) => !file.includes(".server."));
      for (const file of open) seen.add(file);

      const scripts = app.filter((file) => file.endsWith(".ts"));
      const modules = await Promise.all(scripts.map((file) => loadModule.run({ input: file })));
      contracts.push(...modules.flatMap((loaded) => contractsOf.run({ input: loaded })));
      const next = await Promise.all(app.map((file) => importsOf.run({ input: file })));
      wave = next.flat();
    }
    return contracts;
  },
});

const actionsOf = operation({
  label: "map.actionsOf",
  input: z.object({ file: z.string(), state: z.custom<ViewState>() }),
  depends: { resolveFrom, loadModule },
  run: async ({ resolveFrom, loadModule }, { input: { file, state } }) => {
    const actions: Offered[] = [];
    const files: string[] = [];
    for (const action of state.actions) {
      const from = resolveFrom.run({ input: { file, specifier: action.from } });
      if (!from) continue;

      files.push(from);
      const unit = (await loadModule.run({ input: from }))[action.name];
      if (unit !== undefined) {
        actions.push({ unit, name: action.name, file: from, reads: action.reads });
      }
    }
    return { state: state.state, actions, files };
  },
});

const offersOf = operation({
  label: "map.offersOf",
  input: z.object({ src: z.string(), cell: z.custom<Cell>() }),
  depends: { findView, actionsOf, fieldOf },
  run: async ({ findView, actionsOf, fieldOf }, { input: { src, cell } }) => {
    const view = await findView.run({ input: { src, cell: cell.name } });
    if (!view) {
      const actions = Object.values(cell.module).filter(
        (value) =>
          fieldOf.run({ input: { value, key: "run" } }) !== undefined ||
          fieldOf.run({ input: { value, key: "def" } }) !== undefined,
      );
      const offers: Offers = { kind: "all", actions };
      return { view: null, files: [cell.file], offers };
    }

    const files = new Set([cell.file, view.file]);
    const states = [];
    for (const state of view.states) {
      const offered = await actionsOf.run({ input: { file: view.file, state } });
      for (const file of offered.files) files.add(file);
      states.push({ state: offered.state, actions: offered.actions });
    }
    const offers: Offers = { kind: "view", states };
    return { view: view.file, files: [...files], offers };
  },
});

const mapOf = operation({
  label: "map.mapOf",
  input: z.object({
    root: z.string(),
    cell: z.custom<Cell>(),
    view: z.string().nullable(),
    offers: z.custom<Offers>(),
    contracts: z.array(z.record(z.string(), z.unknown())),
  }),
  depends: { deriveMap, placeMap },
  run: async ({ deriveMap, placeMap }, { input }): Promise<MapJson> => {
    const { root, cell, view, offers, contracts } = input;
    const found = await deriveMap.run({ input: { cell: cell.value, offers, contracts } });
    const states = found.states.map((each) => each.state);
    const places = placeMap.run({ input: { start: found.start, states, moves: found.moves } });

    return {
      cell: found.cell,
      start: found.start,
      view: view ? relative(root, view) : null,
      calls: found.calls,
      states: places.flatMap((place) => {
        const state = found.states.find((each) => each.state === place.state);
        if (!state) return [];
        return [{ ...place, sample: state.sample, actions: state.actions, run: state.run }];
      }),
      moves: found.moves.map(({ rank: _rank, ...move }) => move),
      stays: found.stays,
    };
  },
});

export const deriveOf = operation({
  label: "map.deriveOf",
  input: z.object({ root: z.string(), label: z.string() }),
  depends: { findCell, offersOf, contractsFrom, mapOf },
  run: async ({ findCell, offersOf, contractsFrom, mapOf }, { input: { root, label } }) => {
    const src = join(root, "src");
    const cell = await findCell.run({ input: { src, label } });
    if (!cell) return { kind: "missing" as const };

    const { view, files, offers } = await offersOf.run({ input: { src, cell } });
    const contracts = await contractsFrom.run({ input: { src, files } });
    const map = await mapOf.run({ input: { root, cell, view, offers, contracts } });
    const offered = offers.kind === "view" ? offers.states.flatMap((state) => state.actions) : [];
    const actions = offered.filter(
      (action, at) => offered.findIndex((other) => other.name === action.name) === at,
    );
    const { file, name, value } = cell;
    const derived: Derived = { map, cell: { file, name, value }, view, contracts, actions };
    return { kind: "derived" as const, derived };
  },
});
