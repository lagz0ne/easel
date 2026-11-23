import { framesContracts, framesSuccessKinds } from "@/frames/contract";

// The tool table (SPEC-mcp.md § Contract): one row per tool, named after its call. The input and
// output schemas come from the call's contract, and `isError` from its success list (fact rules
// 2 and 5). A row holds only what the contract does not: the name, the hints and when to use it.

/** Every contract that has tools, by address. */
export const contracts = { ...framesContracts };

/** Every success list of those contracts, by address. */
export const successLists = { ...framesSuccessKinds };

/** One tool: its call, its MCP hints, and a description of when to use it. */
export const tools = {
  list_canvases: {
    address: "canvas.list",
    annotations: { readOnlyHint: true },
    description:
      "List the canvases of this easel: key, name, when it was made, and whether it is shared. Use a key in the other tools.",
  },
} as const;

export type ToolName = keyof typeof tools;
