import { resource } from "@tinkered/core";
import type { Capsule, Data, Operation, Tag, transport } from "@tinkered/core";
import { z } from "zod";

export type Remote = { call: transport.Call; watch: transport.Watch };

export type Rpc = (config: { remote: Remote }) => Capsule.Installable;

export type Action = {
  label: string;
  run:
    | { kind: "press"; unit: Operation.Handle<unknown, unknown> }
    | { kind: "open"; unit: Data.Built<unknown> };
  calls: string[];
  rpcs: Rpc[];
  tags: Array<Tag.Handle<unknown>>;
};

type Reach = {
  seen: Set<unknown>;
  calls: Set<string>;
  rpcs: Set<Rpc>;
  tags: Array<Tag.Handle<unknown>>;
};

export const cellShape = z.custom<Data.Cell<unknown>>(
  (value) =>
    typeof value === "object" && value !== null && "initial" in value && "controller" in value,
);

const operationShape = z.custom<Operation.Handle<unknown, unknown>>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "run" in value &&
    "depends" in value &&
    "controller" in value,
);

const builtShape = z.custom<Data.Built<unknown>>(
  (value) =>
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "kind" in value &&
    value.kind === "built",
);

const tagShape = z.custom<Tag.Handle<unknown>>(
  (value) => typeof value === "function" && "hasDefault" in value && "parse" in value,
);

const rpcShape = z.custom<Rpc>(
  (value) => typeof value === "function" && "addresses" in value && Array.isArray(value.addresses),
);

export const unitReader = resource({
  label: "map.unitReader",
  target: "scope",
  factory: () => {
    const holders = new Set(["object", "function"]);
    const kindShape = z.object({ kind: z.string() }).loose();

    const units = {
      fieldOf: (value: unknown, key: string): unknown =>
        holders.has(typeof value) && value !== null ? Reflect.get(Object(value), key) : undefined,

      labelOf: (value: unknown): string => {
        const own = units.fieldOf(value, "label");
        const def = units.fieldOf(units.fieldOf(value, "def"), "label");
        return typeof own === "string" ? own : typeof def === "string" ? def : "?";
      },

      kindOf: (value: unknown): string => {
        const read = kindShape.safeParse(value);
        return read.success ? read.data.kind : (JSON.stringify(value) ?? "undefined");
      },

      nextOf: (value: unknown): unknown[] => {
        const target = units.fieldOf(value, "target");
        if (target !== undefined) return [target];

        const own =
          units.fieldOf(value, "depends") ?? units.fieldOf(units.fieldOf(value, "def"), "depends");
        return holders.has(typeof own) && own !== null ? Object.values(Object(own)) : [];
      },

      callOf: (value: unknown): { call: string; rpc: Rpc } | null => {
        const capsule = rpcShape.safeParse(units.fieldOf(value, "capsule"));
        const call = units.labelOf(value);
        const addresses = units.fieldOf(capsule.data, "addresses");
        const named = Array.isArray(addresses) && addresses.includes(call);
        return capsule.success && named ? { call, rpc: capsule.data } : null;
      },

      reach: (value: unknown, cell: unknown, found: Reach) => {
        if (found.seen.has(value) || value === cell) return;
        found.seen.add(value);

        const tag = tagShape.safeParse(value);
        if (tag.success) return void found.tags.push(tag.data);

        const call = units.callOf(value);
        if (call) {
          found.calls.add(call.call);
          return void found.rpcs.add(call.rpc);
        }

        for (const next of units.nextOf(value)) units.reach(next, cell, found);
      },

      actionOf: (unit: unknown, cell: unknown): Action | null => {
        const found: Reach = { seen: new Set(), calls: new Set(), rpcs: new Set(), tags: [] };
        units.reach(unit, cell, found);
        const base = {
          label: units.labelOf(unit),
          calls: [...found.calls],
          rpcs: [...found.rpcs],
          tags: found.tags,
        };

        const press = operationShape.safeParse(unit);
        if (press.success) return { ...base, run: { kind: "press", unit: press.data } };

        const open = builtShape.safeParse(unit);
        return open.success ? { ...base, run: { kind: "open", unit: open.data } } : null;
      },
    };

    return units;
  },
});
