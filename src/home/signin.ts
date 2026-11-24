import { data, operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { access } from "@/access";
import { authPaths, modes, name as userName, openPath, signInLink } from "@/access/contract";

import { projectName, siteMeta } from "./contract";

const step = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("name") }),
  z.object({ kind: z.literal("code"), code: z.string(), expiresAt: z.number() }),
  z.object({ kind: z.literal("denied") }),
  z.object({ kind: z.literal("expired") }),
  z.object({ kind: z.literal("slow"), retryIn: z.number() }),
  z.object({ kind: z.literal("in") }),
  z.object({ kind: z.literal("lost") }),
]);

export type SignInStep = z.infer<typeof step>;

export const signInStep = data<SignInStep>({ label: "home.signInStep", initial: { kind: "name" } });

export const postForm = tag<(action: string, fields: Readonly<Record<string, string>>) => void>({
  label: "home.postForm",
  default: (action, fields) => {
    const form = document.createElement("form");
    form.method = "post";
    form.action = action;

    for (const [field, value] of Object.entries(fields)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = field;
      input.value = value;
      form.append(input);
    }

    document.body.append(form);
    form.submit();
  },
});

export const takeHash = tag<(path: string) => string>({
  label: "home.takeHash",
  default: (path) => {
    const hash = location.hash.slice(1);

    history.replaceState(null, "", path);
    return hash;
  },
});

export const siteShape = z.object({
  mode: z.enum(modes).catch("approve"),
  project: projectName.nullable().catch(null),
});

export type Site = z.infer<typeof siteShape>;

export const readSite = tag<() => Site>({
  label: "home.readSite",
  default: () =>
    siteShape.parse({
      mode: document.querySelector(`meta[name="${siteMeta.mode}"]`)?.getAttribute("content"),
      project:
        document.querySelector(`meta[name="${siteMeta.project}"]`)?.getAttribute("content") ?? null,
    }),
});

export const writeClipboard = tag<(text: string) => Promise<void>>({
  label: "home.writeClipboard",
  default: (text) => navigator.clipboard.writeText(text),
});

export const copyApproveCommand = operation({
  label: "home.copyApproveCommand",
  input: z.object({ code: z.string() }),
  depends: { write: writeClipboard },
  run: ({ write }, { input }) => write(`easel users approve ${input.code}`),
});

const signedOut = z.object({ signIn: z.literal(true) });

export const whoAmI = operation({
  label: "home.whoAmI",
  input: z.object({ stop: z.instanceof(AbortSignal).optional() }),
  depends: { me: access.user["users.me"] },
  run: async ({ me }, { input }) => {
    const reply = await me.settle({ input: null, signal: input.stop });
    const { name, owner } = reply.status === "success" ? reply.value : { name: "", owner: false };
    if (reply.status === "success") return { kind: "in" as const, name, owner };

    const error = reply.status === "failed" ? reply.error : reply.reason;
    const out = access.user.fault.is(error) && signedOut.safeParse(error.payload).success;
    if (!out) throw error;
    return { kind: "out" as const };
  },
});

export type Who = Awaited<ReturnType<typeof whoAmI.run>>;

export const readHome = operation({
  label: "home.readHome",
  input: z.object({ stop: z.instanceof(AbortSignal).optional() }),
  depends: { whoAmI, readSite },
  run: async ({ whoAmI, readSite }, { input }) => ({
    who: await whoAmI.run({ input }),
    site: readSite(),
  }),
});

const firstPause = 1_000;

const longestPause = 10_000;

const waitForApproval = operation({
  label: "home.waitForApproval",
  input: z.object({ request: z.string() }),
  depends: { wait: access.browser["browser.wait"], step: signInStep.controller, post: postForm },
  run: async ({ wait, step, post }, { input, clock, signal }) => {
    for (let pause = firstPause; ;) {
      const reply = await wait.settle({ input, signal });
      if (reply.status !== "success") {
        await clock.sleep(pause, signal);
        pause = Math.min(pause * 2, longestPause);
        continue;
      }
      pause = firstPause;
      const now = reply.value;
      switch (now.kind) {
        case "pending":
          continue;
        case "slow":
          await clock.sleep(now.retryIn, signal);
          continue;
        case "approved":
          step.set({ kind: "in" });
          return post(authPaths.code, { request: input.request });
        case "denied":
          return step.set({ kind: "denied" });
        case "expired":
          return step.set({ kind: "expired" });
      }
    }
  },
});

export const askForCode = operation({
  label: "home.askForCode",
  input: z.object({ name: userName.optional() }),
  depends: { start: access.browser["browser.start"], step: signInStep.controller, waitForApproval },
  run: async ({ start, step, waitForApproval }, { input }) => {
    const shown = await start.run({ input });
    switch (shown.kind) {
      case "name":
        return step.set({ kind: "name" });
      case "slow":
        return step.set({ kind: "slow", retryIn: shown.retryIn });
      case "pending":
        step.set({ kind: "code", code: shown.code, expiresAt: shown.expiresAt });
        return waitForApproval.run({ input: { request: shown.request } });
    }
  },
});

export const codeAtOnce = resource({
  label: "home.codeAtOnce",
  config: {},
  depends: { askForCode, step: signInStep.controller },
  factory: ({ askForCode, step }) => {
    askForCode.run({ input: {} }).then(
      () => undefined,
      () => step.set({ kind: "lost" }),
    );

    return { asked: true };
  },
});

export const askAgain = operation({
  label: "home.askAgain",
  depends: { step: signInStep.controller },
  run: ({ step }) => step.set({ kind: "name" }),
});

export const readSignInLink = operation({
  label: "home.readSignInLink",
  input: z.object({ stop: z.instanceof(AbortSignal).optional() }),
  depends: { takeHash, peek: access.browser["browser.peek"], whoAmI },
  run: async ({ takeHash, peek, whoAmI }, { input }) => {
    const link = signInLink.safeParse(takeHash(openPath));
    if (!link.success) return { kind: "bad" as const };

    const [shown, who] = await Promise.all([
      peek.run({ input: { link: link.data }, signal: input.stop }),
      whoAmI.run({ input }),
    ]);
    const now = who.kind === "in" ? who.name : null;
    switch (shown.kind) {
      case "gone":
        return { kind: "bad" as const };
      case "slow":
        return { kind: "slow" as const, retryIn: shown.retryIn };
      case "live":
        return { kind: "ask" as const, link: link.data, name: shown.name, now };
    }
  },
});

export type OpenLink = Awaited<ReturnType<typeof readSignInLink.run>>;

export const useSignInLink = operation({
  label: "home.useSignInLink",
  input: z.object({ link: signInLink }),
  depends: { post: postForm },
  run: ({ post }, { input }) => post(authPaths.open, { link: input.link }),
});
