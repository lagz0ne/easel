import { createWs as createServer } from "@tinkered/bun";
import { createWs as createClient } from "@tinkered/bun/client";
import type { Scope } from "@tinkered/core";

export const createWs = () => ({ ...createClient(), ...createServer() });

export { ws as wsClient } from "@tinkered/bun/client";
export { ws as wsServer } from "@tinkered/bun";

type Door = {
  upgrade: (r: Request, s: Scope.Handle, b: never) => Response | null | undefined;
  websocket: never;
};

export function listen(
  scope: Scope.Handle,
  transports: readonly unknown[],
  other?: (r: Request) => Promise<Response | undefined> | Response | undefined,
) {
  const doors = transports.map((t) => scope.resolve(t as never) as Door);
  const bun = Bun.serve({
    port: 0,
    idleTimeout: 0,
    websocket: doors[0]!.websocket,
    fetch: async (r, b) => {
      for (const door of doors) {
        const reply = door.upgrade(r, scope, b as never);
        if (reply === null) return undefined;
        if (reply) return reply;
      }
      return (await other?.(r)) ?? new Response(null, { status: 404 });
    },
  });

  return { bun, url: `ws://localhost:${bun.port}` };
}
