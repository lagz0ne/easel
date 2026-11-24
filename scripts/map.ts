import { dirname, join, relative } from "node:path";

import { createScope } from "@tinkered/core";
import type { Data } from "@tinkered/core";

import { deriveMap } from "@/map/derive";
import { placeMap } from "@/map/place";
import { mapText } from "@/map/text";
import type { MapJson } from "@/map/text";
import { cellShape } from "@/map/units";
import { readView } from "@/map/view";
import type { ViewState } from "@/map/view";

const usage = `bun scripts/map.ts <cell label> [--json]

Finds the cell with that label in src/, the view that switches on its kind, the actions of each
state, their calls and the answers of each call. It runs each action from each state with each
answer forced, and prints the map: each state in its place (the steps from the start as columns,
the main path on row 0, each other answer on a row below), each move and each stay (SPEC-prototype).
--json prints the map as JSON.

Exit: 0 with a map; 1 when no module of src/ exports a cell with that label; 64 on a wrong argument.`;

const root = join(import.meta.dir, "..");
const src = join(root, "src");
const appImport = /^(\.|@\/)/;
const contractDepth = 4;
const scanner = new Bun.Transpiler({ loader: "tsx" });

type Module = Readonly<Record<string, unknown>>;

type Cell = { file: string; name: string; value: Data.Cell<unknown>; module: Module };

type Offers =
  | { kind: "view"; states: Array<{ state: string; actions: unknown[] }> }
  | { kind: "all"; actions: unknown[] };

function fieldOf(value: unknown, key: string): unknown {
  const holder = (typeof value === "object" || typeof value === "function") && value !== null;
  return holder ? Reflect.get(value, key) : undefined;
}

async function filesOf(pattern: string) {
  const found: string[] = [];
  for await (const file of new Bun.Glob(pattern).scan({ cwd: src, absolute: true })) {
    found.push(file);
  }
  return found.sort();
}

async function load(file: string): Promise<Module> {
  return { ...(await import(file)) };
}

function cellIn(file: string, module: Module, label: string): Cell | null {
  for (const [name, value] of Object.entries(module)) {
    const cell = cellShape.safeParse(value);
    if (cell.success && fieldOf(value, "label") === label) {
      return { file, name, value: cell.data, module };
    }
  }
  return null;
}

async function findCell(label: string) {
  for (const file of await filesOf("**/*.ts")) {
    const named = (await Bun.file(file).text()).includes(`"${label}"`);
    if (!named || file.includes(".server.")) {
      continue;
    }

    const cell = cellIn(file, await load(file), label);
    if (cell) return cell;
  }
  return null;
}

async function findView(cell: string) {
  const scope = createScope();
  try {
    for (const file of await filesOf("**/*.tsx")) {
      const source = await Bun.file(file).text();
      if (!source.includes(cell) || !source.includes("useData(")) continue;

      const view = scope.run(readView, { input: { file, source, cell } });
      if (view.kind === "found") return { file, states: view.states };
    }
    return null;
  } finally {
    await scope.close();
  }
}

function resolveFrom(file: string, specifier: string) {
  try {
    return Bun.resolveSync(specifier, dirname(file));
  } catch {
    return null;
  }
}

async function importsOf(file: string) {
  const imports = scanner.scanImports(await Bun.file(file).text());
  return imports.flatMap(({ path }) => {
    const target = appImport.test(path) ? resolveFrom(file, path) : null;
    return target && /\.tsx?$/.test(target) ? [target] : [];
  });
}

function contractsOf(module: Module) {
  return Object.values(module).flatMap((value) => {
    const entries =
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.entries(value)
        : [];
    const isContract =
      entries.length > 0 && entries.every(([, member]) => fieldOf(member, "output") !== undefined);
    return isContract ? [Object.fromEntries(entries)] : [];
  });
}

async function contractsFrom(files: readonly string[]) {
  const seen = new Set<string>();
  const contracts: Array<Record<string, unknown>> = [];
  let wave = [...files];
  for (let depth = 0; depth < contractDepth; depth += 1) {
    const open = wave.filter((file) => !seen.has(file) && file.startsWith(src));
    const app = open.filter((file) => !file.includes(".server."));
    for (const file of open) seen.add(file);

    const modules = await Promise.all(app.filter((file) => file.endsWith(".ts")).map(load));
    contracts.push(...modules.flatMap(contractsOf));
    wave = (await Promise.all(app.map(importsOf))).flat();
  }
  return contracts;
}

async function actionsOf(file: string, state: ViewState, files: Set<string>) {
  const actions: unknown[] = [];
  for (const action of state.actions) {
    const from = resolveFrom(file, action.from);
    const unit = from ? (await load(from))[action.name] : undefined;
    if (from) files.add(from);
    if (unit !== undefined) actions.push(unit);
  }
  return { state: state.state, actions };
}

async function offersOf(
  cell: Cell,
): Promise<{ view: string | null; files: string[]; offers: Offers }> {
  const view = await findView(cell.name);
  if (!view) {
    const actions = Object.values(cell.module).filter(
      (value) => fieldOf(value, "run") !== undefined || fieldOf(value, "def") !== undefined,
    );
    return { view: null, files: [cell.file], offers: { kind: "all", actions } };
  }

  const files = new Set([cell.file, view.file]);
  const states = [];
  for (const state of view.states) states.push(await actionsOf(view.file, state, files));
  return { view: view.file, files: [...files], offers: { kind: "view", states } };
}

async function mapOf(cell: Cell): Promise<MapJson> {
  const { view, files, offers } = await offersOf(cell);
  const contracts = await contractsFrom(files);
  const scope = createScope();
  try {
    const found = await scope.run(deriveMap, { input: { cell: cell.value, offers, contracts } });
    const states = found.states.map((each) => each.state);
    const places = scope.run(placeMap, {
      input: { start: found.start, states, moves: found.moves },
    });

    return {
      cell: found.cell,
      start: found.start,
      view: view ? relative(root, view) : null,
      calls: found.calls,
      states: places.flatMap((place) => {
        const state = found.states.find((each) => each.state === place.state);
        return state ? [{ ...place, sample: state.sample, actions: state.actions }] : [];
      }),
      moves: found.moves.map(({ rank: _rank, ...move }) => move),
      stays: found.stays,
    };
  } finally {
    await scope.close();
  }
}

async function main(args: readonly string[]) {
  const json = args.includes("--json");
  const rest = args.filter((arg) => arg !== "--json");
  const [label] = rest;
  if (rest.length !== 1 || !label || label.startsWith("-")) {
    process.stderr.write(`${usage}\n`);
    return 64;
  }

  const cell = await findCell(label);
  if (!cell) {
    process.stderr.write(`map: no cell ${label} in src/\n`);
    return 1;
  }

  const map = await mapOf(cell);
  const scope = createScope();
  const text = json ? JSON.stringify(map, null, 2) : scope.run(mapText, { input: map });
  await scope.close();
  process.stdout.write(`${text}\n`);
  return 0;
}

process.exit(await main(process.argv.slice(2)));
