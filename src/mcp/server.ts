import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { operation, tag } from "@tinkered/core";
import { z } from "zod";

import { frames } from "@/frames";

import { contracts, successLists, tools } from "./tools";

// An MCP server of easel's calls (SPEC-mcp.md): each tool runs exactly one call of the contract
// through the rpc client of the scope, so the server's guards run as they do on the socket. No
// tool has logic of its own (fact rule 1). The link is the cmd's: stdio for `easel mcp`.
//
// The SDK loads only when a serve starts (`import()`): the server's first answer does not wait for
// it, and the bundle of the binary cannot run its module before zod's.

/** The MCP link to serve on, made by the cmd when the serve starts. */
export const mcpLink = tag<() => Promise<Transport>>({ label: "mcp.link" });

/** What the server tells an agent in its answer to `initialize`. */
const instructions =
  "Frames are made from the kit of this easel. Call `kit_guide` before the first `put_frame`; call `kit_capsules` before the first app frame.";

/** A JSON Schema object at the top, as MCP takes one. */
const objectSchema = z.looseObject({
  type: z.literal("object"),
  properties: z.record(z.string(), z.looseObject({})).optional(),
  required: z.array(z.string()).optional(),
});

/** A schema as MCP takes it: a JSON Schema object at the top. A call with no input takes `{}`. */
const asObject = z.custom<z.ZodType>().transform((schema) => {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  const top =
    json.type === "null" ? { type: "object", properties: {} } : { ...json, type: "object" };

  return objectSchema.parse(top);
});

/** Each tool as `tools/list` answers it. */
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

/** One line for each fault: what happened, and what to do next (SPEC-mcp.md § Built on Tinker). */
const faultText = z
  .object({ fault: z.string(), address: z.string(), payload: z.unknown(), trace: z.string() })
  .transform(({ fault, address, payload, trace }) => {
    const failed = `the server failed (trace ${trace}): an owner can run show_error with it`;
    const told: Record<string, string> = {
      refused: `refused ${JSON.stringify(payload)}: a sign-in needs \`easel login\`; anything else, ask an owner`,
      failed,
      encode: failed,
      decode: failed,
      invalid: `the input is wrong: ${JSON.stringify(payload)}`,
      missing: `this easel has no ${address}: update easel`,
      link: "cannot reach the easel server: check that it runs, then call again",
    };

    return told[fault] ?? failed;
  });

/** A call that did not answer, as a tool error. An error that is no rpc fault is thrown on. */
const faultResult = operation({
  label: "mcp.faultResult",
  input: z.unknown(),
  run: (_, { input: error }): CallToolResult => {
    if (!frames.api.fault.is(error)) throw error;

    const trace = error.traceId ?? error.execution ?? "none";
    const { fault, address, payload } = error;
    const text = faultText.parse({ fault, address, payload, trace });
    return { isError: true, content: [{ type: "text", text }] };
  },
});

/** A call's answer, as it is: an error when its kind is not on the call's success list. */
const answerResult = operation({
  label: "mcp.answerResult",
  input: z.object({ address: z.enum(Object.keys(successLists)), value: z.looseObject({}) }),
  run: (_, { input: { address, value } }): CallToolResult => {
    const kind = "kind" in value ? String(value.kind) : undefined;
    const list = Object.entries(successLists).find(([at]) => at === address)?.[1] ?? [];
    const ok = [list].flat().some((k) => k === "always" || k === kind);
    const text = JSON.stringify(value);

    return { isError: !ok, structuredContent: value, content: [{ type: "text", text }] };
  },
});

/** A tool call: its call run through the rpc client, its answer as a tool result. */
export const mcpCall = operation({
  label: "mcp.call",
  input: z.object({
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()).optional(),
  }),
  depends: { faultResult, answerResult, "canvas.list": frames.api["canvas.list"] },
  run: async ({ faultResult, answerResult, ...calls }, { input, signal }) => {
    const row = Object.entries(tools).find(([name]) => name === input.name)?.[1];
    if (!row) {
      const text = `no tool ${input.name}: list the tools again`;
      return { isError: true, content: [{ type: "text" as const, text }] };
    }

    const takesNull = contracts[row.address].input instanceof z.ZodNull;
    const rawInput = takesNull ? null : (input.arguments ?? {});
    const reply = await calls[row.address].settle({ rawInput, signal });
    if (reply.status === "failed") return faultResult.run({ input: reply.error });
    if (reply.status === "cancelled") return faultResult.run({ input: reply.reason });

    return answerResult.run({ input: { address: row.address, value: reply.value } });
  },
});

/** Serves MCP on the link until it closes, or until the run stops. */
export const mcpServe = operation({
  label: "mcp.serve",
  depends: { toolList, call: mcpCall, link: mcpLink.required },
  run: async ({ toolList, call, link }, { signal }) => {
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
