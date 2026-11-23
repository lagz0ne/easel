import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { isError, operation, tag } from "@tinkered/core";
import type { RunResult } from "@tinkered/core";
import { z } from "zod";

import { ownerApi } from "@/access/contract";
import { framesApi } from "@/frames/contract";
import { kitApi } from "@/kit/contract";
import { opsOwnerApi, opsUserApi } from "@/ops/contract";
import { queueApi } from "@/queue/contract";

import { answerText } from "./texts";
import { contracts, successLists, tools } from "./tools";

export const mcpLink = tag<() => Promise<Transport>>({ label: "mcp.link" });

const instructions =
  "Frames are made from the kit of this easel. Call `kit_capsules` before the first app frame.";

const objectSchema = z.looseObject({
  type: z.literal("object"),
  properties: z.record(z.string(), z.looseObject({})).optional(),
  required: z.array(z.string()).optional(),
});

const asObject = z.custom<z.ZodType>().transform((schema) => {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  const top =
    json.type === "null" ? { type: "object", properties: {} } : { ...json, type: "object" };

  return objectSchema.parse(top);
});

const toolList = operation({
  label: "mcp.tools",
  run: (): Tool[] =>
    Object.entries(tools).map(([name, row]) => ({
      name,
      description: row.description,
      annotations: row.annotations,
      inputSchema: asObject.parse(contracts[row.address].input),
      outputSchema: asObject.parse(contracts[row.address].output),
    })),
});

const issuesText = z.unknown().transform((raw) => {
  const segment = z.union([
    z.string(),
    z.number(),
    z.object({ key: z.union([z.string(), z.number()]) }),
  ]);
  const issue = z.object({ message: z.string(), path: z.array(segment).optional() });
  const issues = z.array(issue);
  const found = z
    .union([
      issues,
      z.object({ issues }).transform((one) => one.issues),
      z.object({ payload: z.object({ issues }) }).transform((one) => one.payload.issues),
    ])
    .safeParse(raw);
  const told = (found.data ?? [])
    .map((one) => {
      const path = (one.path ?? []).map((at) => (typeof at === "object" ? at.key : at));
      return `${path.join(".") || "input"}: ${one.message}`;
    })
    .join("; ");

  return `the input is wrong${told ? `: ${told}` : ""}. Fix it, then call again.`;
});

const faultText = z
  .object({ fault: z.string(), address: z.string(), payload: z.unknown(), trace: z.string() })
  .transform(({ fault, address, payload, trace }) => {
    const failed = `the server failed (trace ${trace}): an owner can run show_error with it`;
    const told: Record<string, string> = {
      refused: `refused ${JSON.stringify(payload)}: a sign-in needs \`easel login\`; anything else, ask an owner`,
      failed,
      encode: failed,
      decode: failed,
      invalid: issuesText.parse(payload),
      missing: `this easel has no ${address}: update easel`,
      link: "cannot reach the easel server: check that it runs, then call again",
    };

    return told[fault] ?? failed;
  });

const rpcFault = z.object({
  fault: z.string(),
  address: z.string(),
  payload: z.unknown(),
  traceId: z.string().optional(),
  execution: z.string().optional(),
});

type Caller = {
  settle(call: { rawInput: unknown; signal: AbortSignal }): PromiseLike<RunResult<object>>;
};

export const faultResult = operation({
  label: "mcp.faultResult",
  input: z.unknown(),
  run: (_, { input: error }): CallToolResult => {
    if (isError(error, "DataValidationFailed")) {
      return { isError: true, content: [{ type: "text", text: issuesText.parse(error.payload) }] };
    }

    const apis = [framesApi, kitApi, queueApi, ownerApi, opsUserApi, opsOwnerApi];
    if (!apis.some((api) => api.fault.is(error))) throw error;

    const { fault, address, payload, traceId, execution } = rpcFault.parse(error);
    const text = faultText.parse({
      fault,
      address,
      payload,
      trace: traceId ?? execution ?? "none",
    });
    return { isError: true, content: [{ type: "text", text }] };
  },
});

export const answerResult = operation({
  label: "mcp.answerResult",
  input: z.object({ address: z.enum(Object.keys(successLists)), value: z.looseObject({}) }),
  depends: { answerText },
  run: ({ answerText }, { input: { address, value } }): CallToolResult => {
    const kind = "kind" in value ? String(value.kind) : undefined;
    const list = Object.entries(successLists).find(([at]) => at === address)?.[1] ?? [];
    const ok = [list].flat().some((k) => k === "always" || k === kind);
    const text = answerText.run({ input: { ok, value } });

    return { isError: !ok, structuredContent: value, content: [{ type: "text", text }] };
  },
});

export const mcpCall = operation({
  label: "mcp.call",
  input: z.object({
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()).optional(),
  }),
  depends: {
    faultResult,
    answerResult,
    "canvas.create": framesApi["canvas.create"],
    "canvas.list": framesApi["canvas.list"],
    "canvas.share": framesApi["canvas.share"],
    "canvas.unshare": framesApi["canvas.unshare"],
    "frame.put": framesApi["frame.put"],
    "frame.list": framesApi["frame.list"],
    "frame.get": framesApi["frame.get"],
    "frame.delete": framesApi["frame.delete"],
    "frame.shot": framesApi["frame.shot"],
    "kit.capsules": kitApi["kit.capsules"],
    "kit.check": kitApi["kit.check"],
    "kit.accept": kitApi["kit.accept"],
    "look.get": kitApi["look.get"],
    "look.set": kitApi["look.set"],
    "look.undo": kitApi["look.undo"],
    "request.next": queueApi["request.next"],
    "request.extend": queueApi["request.extend"],
    "request.release": queueApi["request.release"],
    "request.decline": queueApi["request.decline"],
    "request.ask": queueApi["request.ask"],
    "request.resolve": queueApi["request.resolve"],
    "request.list": queueApi["request.list"],
    "request.deliveries": queueApi["request.deliveries"],
    "users.list": ownerApi["users.list"],
    "users.approve": ownerApi["users.approve"],
    "users.deny": ownerApi["users.deny"],
    "users.revoke": ownerApi["users.revoke"],
    "ops.status": opsUserApi["ops.status"],
    "ops.errors": opsOwnerApi["ops.errors"],
    "ops.error": opsOwnerApi["ops.error"],
    "ops.resolveError": opsOwnerApi["ops.resolveError"],
  },
  run: async ({ faultResult, answerResult, ...calls }, { input, signal }) => {
    const row = Object.entries(tools).find(([name]) => name === input.name)?.[1];
    if (!row) {
      const text = `no tool ${input.name}: list the tools again`;
      return { isError: true, content: [{ type: "text" as const, text }] };
    }

    const takesNull = contracts[row.address].input instanceof z.ZodNull;
    const rawInput = takesNull ? null : (input.arguments ?? {});
    const callers: Record<keyof typeof calls, Caller> = calls;
    const reply = await callers[row.address].settle({ rawInput, signal });
    if (reply.status === "failed") return faultResult.run({ input: reply.error });
    if (reply.status === "cancelled") return faultResult.run({ input: reply.reason });

    return answerResult.run({ rawInput: { address: row.address, value: reply.value } });
  },
});

export const mcpServer = operation({
  label: "mcp.server",
  depends: { toolList, call: mcpCall },
  run: async ({ toolList, call }) => {
    const listed = toolList.run();
    const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
    const { CallToolRequestSchema, ListToolsRequestSchema } =
      await import("@modelcontextprotocol/sdk/types.js");
    const server = new Server(
      { name: "easel", version: "1" },
      { capabilities: { tools: {} }, instructions },
    );
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: listed }));
    server.setRequestHandler(CallToolRequestSchema, (request, extra) =>
      call.run({ input: request.params, signal: extra.signal }),
    );

    return server;
  },
});

export const mcpServe = operation({
  label: "mcp.serve",
  depends: { mcpServer, link: mcpLink.required },
  run: async ({ mcpServer, link }, { signal }) => {
    const server = await mcpServer.run();
    const closed = new Promise<void>((done) => {
      server.onclose = done;
    });

    await server.connect(await link());
    const stop = () => void server.close();
    signal.addEventListener("abort", stop, { once: true });

    await closed;
    signal.removeEventListener("abort", stop);
  },
});
