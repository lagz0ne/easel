import { rpc } from "@tinkered/core";
import { z } from "zod";

// The viewer's side of share (SPEC-frames.md § Contract, § Open a share link): `share.open`
// trades a link and a name for a pass, and the pass rides each board read's meta. No guard runs
// before `share.open`: it needs nothing but the link (fact rule 1). Passwords are not built yet,
// so the input is strict: a `password` field is `invalid`.

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

/** A viewer's name, 1 to 40 characters (SPEC-frames § Inputs). */
export const viewerName = z.string().trim().min(1).max(40);

/** Where a link's page is: `/s/<link>` (decision C4). The server answers the path; the CLI joins
 * it to its own server. */
export const sharePrefix = "/s/";

/** A read's meta from a tab that holds a pass: `mayRead` takes it for the pass's canvas. */
export const passMeta = z.object({ pass: sharePass });

/** The viewer's calls. */
export const shareApi = rpc({
  "share.open": {
    input: z.strictObject({ link: shareLink, name: viewerName }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("open"), canvas: z.string(), pass: z.string() }),
      /** Past the flood limit: `retryIn` ms until this address may open again. */
      z.object({ kind: z.literal("slow"), retryIn: z.number() }),
      z.object({ kind: z.literal("gone") }),
    ]),
  },
});

/** SPEC.md rule 1: `share.open`'s success kinds. */
export const shareSuccessKinds = { "share.open": ["open"] } as const;
