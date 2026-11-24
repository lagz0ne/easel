import { exits } from "@tinkered/cli/test";
import { createScope, data, operation, remoteData, rpc, tag, transport } from "@tinkered/core";
import { createMemory, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { routes } from "~/components/requests/index.server";

const { hook } = transport;

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const principal = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("in"), who: z.string(), token: z.string() }),
  z.object({ kind: z.literal("out") }),
]);

const auth = rpc({ "auth.status": { input: z.null(), output: principal } });
const notes = data({ initial: [] as string[] });
const board = remoteData({ notes });
const api = rpc({ "note.add": { input: z.string(), output: z.number() } });

async function boot() {
  const sessions = new Map<string, string>();
  const tokens = new Map<string, string>();
  const user = tag<string>({ label: "user" });
  const statusOf = operation({
    label: "auth.status.do",
    input: z.null(),
    depends: { req: routes.request.required },
    run: ({ req }) => {
      const sid = /sid=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
      const who = sid ? sessions.get(sid) : undefined;
      if (!who) return { kind: "out" as const };
      const token = `tok-${who}-${tokens.size}`;
      tokens.set(token, who);

      return { kind: "in" as const, who, token };
    },
  });
  const whoOf = (meta: Record<string, string>) =>
    tokens.get(/^Bearer (.+)$/.exec(meta.authorization ?? "")?.[1] ?? "");
  const bearer = operation({
    label: "bearer",
    input: hook.start,
    run: async (_, { input }) => {
      const who = whoOf(input.meta);
      return who ? { tags: [user(who)] } : input.refuse({ signIn: true });
    },
  });
  const add = operation({
    label: "note.add.do",
    input: z.string(),
    depends: { list: notes.controller, me: user.required },
    run: ({ list, me }, { input }) => (
      list.set([...list.get(), `${me}: ${input}`]),
      list.get().length
    ),
  });
  const server = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      auth({ implement: { "auth.status": statusOf } }),
      board({ serve: true, onStart: [bearer] }),
      api({ onStart: [bearer], implement: { "note.add": add } }),
      memory.server({ services: [auth, board, api] }),
    ],
  }).ready;
  closers.push(() => server.close());

  return { server, sessions, tokens };
}

const signed = createMemory();
let statusCalls = 0;

const credentials = operation({
  label: "credentials",
  depends: { status: auth["auth.status"] },
  run: async ({ status }): Promise<Record<string, string>> => {
    statusCalls++;
    const now = await status.run({ input: null });
    return now.kind === "in" ? { authorization: `Bearer ${now.token}` } : {};
  },
});

async function client(server: Awaited<ReturnType<typeof boot>>["server"], sid: string) {
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({ peer: server, headers: { cookie: `sid=${sid}` } }),
      auth({ remote: memory.client }),
      signed.client({ peer: server, headers: { cookie: `sid=${sid}` }, meta: credentials }),
      board({ read: signed.client }),
      api({ remote: signed.client }),
    ],
  }).ready;
  closers.push(() => scope.close());
  return scope;
}

test("signed in: the auth check goes over the public transport; the rest carries the bearer", async () => {
  const { server, sessions } = await boot();
  sessions.set("s1", "duke");
  const duke = await client(server, "s1");

  expect(await duke.run(api["note.add"], { input: "hello" })).toBe(1);
  await tick();
  expect(duke.resolve(board.notes).get()).toEqual(["duke: hello"]);
  expect(await duke.run(auth["auth.status"], { input: null })).toMatchObject({
    kind: "in",
    who: "duke",
  });
});

test("a guest: the public transport answers out; the signed calls are refused, the scope stays open", async () => {
  const { server } = await boot();
  const guest = await client(server, "nobody");

  expect(await guest.run(auth["auth.status"], { input: null })).toEqual({ kind: "out" });
  const add = await guest.run(api["note.add"], { input: "x" }).then(
    () => null,
    (e: unknown) => e,
  );
  expect(api.fault.is(add) && add.fault).toBe("refused");
  expect(guest.resolve(board.faults).get().notes?.message).toContain("notes: refused");
});

test("the guest signs in later: a refused key waits until an invalidate, then the board fills without a new scope", async () => {
  const { server, sessions } = await boot();
  const ann = await client(server, "s2");

  expect(ann.resolve(board.faults).get().notes?.fault).toBe("refused");
  sessions.set("s2", "ann");
  expect(await ann.run(api["note.add"], { input: "now in" })).toBe(1);
  await tick(50);
  expect(ann.resolve(board.faults).get().notes?.fault).toBe("refused");
  await ann.run(board.invalidate, { input: { notes: {} } });
  const end = Date.now() + 3000;
  let value: unknown = null;
  while (value === null && Date.now() < end) {
    if (ann.resolve(board.faults).get().notes) await tick(20);
    else value = ann.resolve(board.notes).get();
  }
  expect(value).toEqual(["ann: now in"]);
});

test("the cost: one auth check per signed request (as tRPC headers()); caching it is the app's choice", async () => {
  const { server, sessions } = await boot();
  sessions.set("s3", "bo");
  const bo = await client(server, "s3");
  const before = statusCalls;
  for (let i = 0; i < 5; i++) await bo.run(api["note.add"], { input: String(i) });

  expect(statusCalls - before).toBe(5);
});
