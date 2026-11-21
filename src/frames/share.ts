import { rpc } from "@tinkered/core";
import { z } from "zod";

// The viewer's side of share (SPEC-frames.md § Contract, § Open a share link): `share.open`
// trades a link for a pass, and the pass rides each board read's meta. The page sends the
// viewer's name too, if the browser kept one: the page asks no name at the link. No guard runs
// before `share.open`: it needs nothing but the link (fact rule 1). A link may ask a password:
// `share.open` without one answers `locked`, and with one `wrong`, `slow` or `open`.

/** 128 random bits as 32 hex digits: a share link's name, and a pass. */
const secret = z.string().regex(/^[0-9a-f]{32}$/, "not a share link or pass");

/** A share link: what `/s/<link>` names. */
export const shareLink = secret;

/**
 * What `canvas.share` answers: the link's page, `/s/<link>`. The CLI joins it to its server only
 * in this shape, so an answer cannot point the printed URL at another host (`//host/...`).
 */
export const sharePath = z.string().regex(/^\/s\/[0-9a-f]{32}$/, "not a share link's path");

/** A pass: what a tab sends on each read after `share.open`. Only its digest is kept. */
export const sharePass = secret;

/**
 * A share password as `canvas.share` sets it: 8 characters or more (judged rule 10). At most
 * 1024, so a hash never runs on a document-sized string.
 */
export const sharePassword = z.string().min(8).max(1024);

/** A password as a viewer types it: any wrong one is a try, so only its size is checked. */
export const typedPassword = z.string().min(1).max(1024);

/** A viewer's name, 1 to 40 characters (SPEC-frames § Inputs). */
export const viewerName = z.string().trim().min(1).max(40);

/** Where a link's page is: `/s/<link>` (decision C4). The server answers the path; the CLI joins
 * it to its own server. */
export const sharePrefix = "/s/";

/** A read's meta from a tab that holds a pass: `mayRead` takes it for the pass's canvas. */
export const passMeta = z.object({ pass: sharePass });

/** What `mayRead` refuses a pass whose link ended, or that a newer pass ended (past 1000). */
export const endedRefusal = { ended: true } as const;

/** What `mayRead` refuses a pass a password set or changed ended: the page asks the password. */
export const lockedRefusal = { locked: true } as const;

/** The viewer's calls. */
export const shareApi = rpc({
  "share.open": {
    input: z.strictObject({
      link: shareLink,
      /** The name this browser kept, if it kept one. A pass may have no name. */
      name: viewerName.optional(),
      password: typedPassword.optional(),
    }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("open"), canvas: z.string(), pass: z.string() }),
      /** The link asks a password, and none came: the password page. Not a try. */
      z.object({ kind: z.literal("locked") }),
      /** A wrong password, one of the first 5 in a minute from this address on this link. */
      z.object({ kind: z.literal("wrong") }),
      /**
       * Past the flood limit, or a try in the lock after 5 wrong ones in a minute: `retryIn` ms
       * until this address may open again, or until the lock ends, a minute from the 5th.
       */
      z.object({ kind: z.literal("slow"), retryIn: z.number() }),
      z.object({ kind: z.literal("gone") }),
    ]),
  },
});

/** SPEC.md rule 1: `share.open`'s success kinds. */
export const shareSuccessKinds = { "share.open": ["open"] } as const;

/**
 * The calls of a tab that holds a pass: `mayName` runs first. `share.name` sets the viewer's name
 * on the pass the tab holds, at the first request (SPEC-viewer § Open the link). The pass is the
 * proof, so the page does not ask the password again. A pass takes a name once: the answer is the
 * name the pass holds, which is the first one it took.
 */
export const passApi = rpc({
  "share.name": {
    input: z.strictObject({ canvas: z.string(), name: viewerName }),
    output: z.object({ kind: z.literal("named"), name: z.string() }),
  },
});

/** SPEC.md rule 1: `share.name`'s success kinds. */
export const passSuccessKinds = { "share.name": ["named"] } as const;
