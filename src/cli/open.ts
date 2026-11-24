import { operation, tag } from "@tinkered/core";
import { z } from "zod";

import { access } from "@/access";
import { openPath } from "@/access/contract";

import { deadline, exitOf, faultExit } from "./exit";
import { server } from "./hosts";
import { say } from "./output";

export const browserOpener = tag<((url: string) => Promise<boolean>) | null>({
  label: "cli.browserOpener",
  default: null,
});

export const openBrowser = operation({
  label: "cli.open",
  input: z.object({ noBrowser: z.boolean() }),
  depends: {
    say,
    exitOf,
    faultExit,
    deadline,
    link: access.open["browser.link"],
    server: server.required,
    opener: browserOpener,
  },
  run: async ({ say, exitOf, faultExit, deadline, link, server, opener }, { input }) => {
    const stop = deadline.run({ input: "browser.link" });
    const reply = await link.settle({ input: null, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return faultExit.run({ input: reply.reason });
    if (reply.status === "failed") return faultExit.run({ input: reply.error });

    const answer = reply.value;
    const url = `${server}${openPath}#${answer.link}`;
    const opened = !input.noBrowser && opener !== null && (await opener(url));
    const until = new Date(answer.expiresAt).toISOString();
    const how = opened ? "easel opened it in your browser" : "open it in a browser";
    const text = `${how}. It signs in one browser as you, one time, until ${until}:\n${url}`;
    say.run({
      input: { json: { kind: answer.kind, url, expiresAt: answer.expiresAt, opened }, text },
    });
    return exitOf.run({ input: { address: "browser.link", kind: answer.kind } });
  },
});
