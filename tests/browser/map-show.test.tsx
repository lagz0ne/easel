import { exits } from "@tinkered/cli/test";
import { createScope, data, operation, rpc } from "@tinkered/core";
import { ScopeProvider, useData, useRun } from "@tinkered/react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, test } from "vite-plus/test";
import { page } from "vite-plus/test/browser/context";
import { z } from "zod";

import { SignIn } from "@/home/home";
import { askForCode, signInStep } from "@/home/signin";
import { pressIn, showScope } from "@/map/show";
import type { ShowPlan } from "@/map/show";

const tool = await createScope({ capsules: [exits({ store: localStorage })] }).ready;

const contract = {
  "fixture.send": {
    input: z.object({ name: z.string() }),
    output: z.object({ kind: z.literal("sent") }),
  },
};

const api = rpc(contract);

const sent = data<{ kind: string }>({ label: "fixture.sent", initial: { kind: "idle" } });

const send = operation({
  label: "fixture.send",
  input: z.object({ name: z.string() }),
  depends: { call: api["fixture.send"], sent: sent.controller },
  run: async ({ call, sent }, { input }) => sent.set(await call.run({ input })),
});

function Form() {
  const now = useData(sent);
  const go = useRun(send);
  return (
    <form
      data-map-press="send"
      onSubmit={(event) => {
        event.preventDefault();
        const name = new FormData(event.currentTarget).get("name");
        if (typeof name === "string") go.run({ input: { name } });
      }}
    >
      <input name="name" />
      <button type="submit" disabled={go.isPending}>
        Send
      </button>
      {go.error ? <p role="alert">Not sent.</p> : null}
      <p role="status">{now.kind}</p>
    </form>
  );
}

const lateBy = 400;

const sendLate = operation({
  label: "fixture.sendLate",
  input: z.object({ name: z.string() }),
  depends: { call: api["fixture.send"], sent: sent.controller },
  run: async ({ call, sent }, { input, clock }) => {
    await clock.sleep(lateBy);
    sent.set(await call.run({ input }));
  },
});

function LateForm() {
  const go = useRun(sendLate);
  return (
    <form
      data-map-press="sendLate"
      onSubmit={(event) => {
        event.preventDefault();
        go.run({ input: { name: "ann" } });
      }}
    >
      <button type="submit">Send</button>
      {go.error ? <p role="alert">Not sent.</p> : null}
      {go.isSuccess ? <p role="status">Sent.</p> : null}
    </form>
  );
}

async function shown(
  view: React.ReactElement,
  cell: typeof sent | typeof signInStep,
  actions: unknown[],
  plan: ShowPlan,
) {
  const options = tool.run(showScope, { input: { cell, actions, plan } });
  const live = await createScope(options).ready;

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  root.render(<ScopeProvider scope={live}>{view}</ScopeProvider>);

  onTestFinished(async () => {
    root.unmount();
    host.remove();
    const parkedCallsKeepTheScopeOpen = new Promise((done) => setTimeout(done, 200));
    await Promise.race([live.close(), parkedCallsKeepTheScopeOpen]);
  });
  return host;
}

test("a cell state of the real sign-in shows its sample, with no press", async () => {
  const plan = {
    state: "code",
    sample: { kind: "code", code: "BCDF-23", expiresAt: 0 },
    press: null,
    replies: {},
  };
  await shown(<SignIn site={{ mode: "approve", project: null }} />, signInStep, [askForCode], plan);

  expect(await tool.run(pressIn, { input: { page: document, press: null } })).toEqual({
    kind: "shown",
  });
  await expect.element(page.getByText("BCDF-23")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Copy" })).toBeVisible();
});

test("a press fills the fields of its form, and the fault of the plan shows the failed run", async () => {
  const plan = {
    state: "idle · send failed",
    sample: { kind: "idle" },
    press: {
      name: "send",
      fields: { name: "ann" },
      action: "fixture.send",
      status: "failed" as const,
    },
    replies: { "fixture.send": { ok: false as const, kind: "link" as const, payload: null } },
  };
  await shown(<Form />, sent, [send], plan);

  expect(await tool.run(pressIn, { input: { page: document, press: plan.press } })).toEqual({
    kind: "pressed",
    press: "send",
  });
  await expect.element(page.getByRole("alert")).toHaveTextContent("Not sent.");
  await expect.element(page.getByRole("textbox")).toHaveValue("ann");
});

test("a press of a button with no answer in the plan shows the pending run", async () => {
  const plan = {
    state: "idle · send pending",
    sample: { kind: "idle" },
    press: { name: "send", fields: {}, action: "fixture.send", status: "pending" as const },
    replies: {},
  };
  const host = await shown(<Form />, sent, [send], plan);
  host.querySelector("form")?.removeAttribute("data-map-press");
  host.querySelector("button")?.setAttribute("data-map-press", "send");

  expect(await tool.run(pressIn, { input: { page: document, press: plan.press } })).toEqual({
    kind: "pressed",
    press: "send",
  });
  await expect.element(page.getByRole("button", { name: "Send" })).toBeDisabled();
});

test("a press that the page does not have says so", async () => {
  const plan = { state: "idle", sample: { kind: "idle" }, press: null, replies: {} };
  await shown(<Form />, sent, [send], plan);

  expect(
    await tool.run(pressIn, {
      input: {
        page: document,
        press: { name: "none", fields: {}, action: "fixture.send", status: "done" },
        limit: 300,
      },
    }),
  ).toEqual({
    kind: "noPress",
    press: "none",
  });
});

test("a press answers only when the page shows the failed run, however late the run fails", async () => {
  const plan = {
    state: "idle · sendLate failed",
    sample: { kind: "idle" },
    press: { name: "sendLate", fields: {}, action: "fixture.sendLate", status: "failed" as const },
    replies: { "fixture.send": { ok: false as const, kind: "link" as const, payload: null } },
  };
  const host = await shown(<LateForm />, sent, [sendLate], plan);

  await tool.run(pressIn, { input: { page: document, press: plan.press } });
  expect(host.querySelector("[role=alert]")?.textContent).toBe("Not sent.");
});

test("a press answers only when the page shows the done run, however late the run ends", async () => {
  const plan = {
    state: "idle · sendLate done",
    sample: { kind: "idle" },
    press: { name: "sendLate", fields: {}, action: "fixture.sendLate", status: "done" as const },
    replies: { "fixture.send": { ok: true as const, value: { kind: "sent" } } },
  };
  const host = await shown(<LateForm />, sent, [sendLate], plan);

  await tool.run(pressIn, { input: { page: document, press: plan.press } });
  expect(host.querySelector("[role=status]")?.textContent).toBe("Sent.");
});

test("a pending press answers only when its call reached the backend", async () => {
  const plan = {
    state: "idle · sendLate pending",
    sample: { kind: "idle" },
    press: { name: "sendLate", fields: {}, action: "fixture.sendLate", status: "pending" as const },
    replies: {},
  };
  await shown(<LateForm />, sent, [sendLate], plan);

  const started = performance.now();
  await tool.run(pressIn, { input: { page: document, press: plan.press } });
  expect(performance.now() - started).toBeGreaterThanOrEqual(lateBy);
});

test("a press whose run never reaches the status of its state says so, and no picture is taken", async () => {
  const plan = {
    state: "idle · send done",
    sample: { kind: "idle" },
    press: {
      name: "send",
      fields: { name: "ann" },
      action: "fixture.send",
      status: "done" as const,
    },
    replies: { "fixture.send": { ok: false as const, kind: "link" as const, payload: null } },
  };
  await shown(<Form />, sent, [send], plan);

  expect(
    await tool.run(pressIn, { input: { page: document, press: plan.press, limit: 300 } }),
  ).toEqual({ kind: "noStatus", press: "send", status: "done" });
});
