import { data, operation, tag } from "@tinkered/core";
import { z } from "zod";

import { access } from "@/access";
import { authPaths, name as userName, openPath, signInLink } from "@/access/contract";

const step = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("name") }),
  z.object({ kind: z.literal("code"), code: z.string(), expiresAt: z.number() }),
  z.object({ kind: z.literal("denied") }),
  z.object({ kind: z.literal("expired") }),
  z.object({ kind: z.literal("slow"), retryIn: z.number() }),
  z.object({ kind: z.literal("in") }),
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

const waitForApproval = operation({
  label: "home.waitForApproval",
  input: z.object({ request: z.string() }),
  depends: { wait: access.browser["browser.wait"], step: signInStep.controller, post: postForm },
  run: async ({ wait, step, post }, { input, clock, signal }) => {
    for (;;) {
      const now = await wait.run({ input, signal });
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
  input: z.object({ name: userName }),
  depends: { start: access.browser["browser.start"], step: signInStep.controller, waitForApproval },
  run: async ({ start, step, waitForApproval }, { input }) => {
    const shown = await start.run({ input });
    switch (shown.kind) {
      case "slow":
        return step.set({ kind: "slow", retryIn: shown.retryIn });
      case "pending":
        step.set({ kind: "code", code: shown.code, expiresAt: shown.expiresAt });
        return waitForApproval.run({ input: { request: shown.request } });
    }
  },
});

export const askAgain = operation({
  label: "home.askAgain",
  depends: { step: signInStep.controller },
  run: ({ step }) => step.set({ kind: "name" }),
});

export const useSignInLink = operation({
  label: "home.useSignInLink",
  depends: { takeHash, post: postForm },
  run: ({ takeHash, post }) => {
    const link = signInLink.safeParse(takeHash(openPath));
    if (!link.success) return { kind: "bad" as const };

    post(authPaths.open, { link: link.data });
    return { kind: "sent" as const };
  },
});
