---- MODULE Pictures ----
\* SPEC-frames.md § Contract, Pictures, and judged rules 7-9 (F4): a picture is drawn on demand at
\*   GET /api/pictures/<canvas>/<id>/<version>?s=<scale>&k=<key>
\* where key = HMAC(server secret, canvas, id, version, key generation). The key generation
\* goes up when the canvas's share link ends or its password changes, so a key handed to a
\* viewer stops working with the viewer's pass.
\* The server takes the version and its document in one read (a snapshot), draws that, and
\* checks again before it answers. OneRead = FALSE is the design this rules out: it reads the
\* version, then the document in a second read, and an agent's write can land between them, so
\* it draws the newer document for the older address (APictureShowsTheVersionItsAddressNames
\* and AnOldAddressIsRedirectedNotDrawn break). Pictures.cfg has OneRead = TRUE.
\* An old version's address redirects to the current one, unless a request refers to that version:
\* then the server keeps it (judged rule 16), also after the frame is deleted, and draws it.
\* The answer is `Cache-Control: private, immutable`: only the browser that asked keeps it.
\* One frame, one viewer's tab, one request at a time; an agent writes, deletes, or ends the link.
EXTENDS Naturals

MaxVersion == 2

CONSTANT OneRead, KeptFirst

\* KeptFirst: a viewer asked for a change on version 1 (or an agent claimed on it), so a request
\* refers to it and the server keeps its document, also after a write or a delete (judged rule
\* 16). Pictures.cfg has no request (FALSE); PicturesKept.cfg has one (TRUE).
held(v) == KeptFirst /\ v = 1

VARIABLES
  version,  \* the frame's current version
  live,     \* the frame exists
  ended,    \* the link the viewer opened has ended (key generation went up)
  endedAt,  \* the newest version when the link ended (0 = not ended)
  board,    \* the version whose address the tab's board holds (0 = none)
  req,      \* the request: "idle" | "asked" | "redirected" | "drawing" | "sent"
  asked,    \* the version in the requested address
  drawn,    \* the version of the document being drawn (0 = none)
  kept,     \* kept[v]: the version shown by this browser's copy for address v (0 = none)
  shown     \* the newest version the tab has shown

vars == <<version, live, ended, endedAt, board, req, asked, drawn, kept, shown>>

Init ==
  /\ version = 1 /\ live = TRUE /\ ended = FALSE /\ endedAt = 0 /\ board = 1
  /\ req = "idle" /\ asked = 0 /\ drawn = 0
  /\ kept = [v \in 1..MaxVersion |-> 0] /\ shown = 0

\* The server has the document of version v: the frame's current one, or a kept one.
Stored(v) == (live /\ v = version) \/ held(v)

\* The tab's keys all come from before the link ended: its board is refused after that.
KeyOk == ~ended

\* the tab's board catches up with the stored frame (a pushed cell); refused once the link ended
BoardCatchesUp ==
  /\ ~ended /\ req = "idle"
  /\ board # (IF live THEN version ELSE 0)
  /\ board' = IF live THEN version ELSE 0
  /\ UNCHANGED <<version, live, ended, endedAt, req, asked, drawn, kept, shown>>

\* the tab asks for an address its board holds: the frame's, or a kept version's (on a request);
\* this browser's own copy answers if it has one
Ask ==
  /\ req = "idle"
  /\ \E v \in 1..MaxVersion :
       /\ v = board \/ held(v)
       /\ IF kept[v] # 0
            THEN /\ shown' = IF kept[v] > shown THEN kept[v] ELSE shown
                 /\ UNCHANGED <<req, asked>>
            ELSE /\ req' = "asked" /\ asked' = v
                 /\ UNCHANGED shown
  /\ UNCHANGED <<version, live, ended, endedAt, board, drawn, kept>>

\* the server reads the frame: 404 for a wrong key; with one read (OneRead), the document of the
\* version asked when it has it (current or kept); else 404 for a gone frame, and a redirect for
\* an old version; without OneRead, a second read (ReadTheDocument) takes the document
LookUp ==
  /\ req = "asked"
  /\ CASE ~KeyOk                   -> req' = "idle" /\ UNCHANGED <<asked, drawn>>
       [] OneRead /\ Stored(asked) -> req' = "drawing" /\ drawn' = asked /\ UNCHANGED asked
       [] ~live                    -> req' = "idle" /\ UNCHANGED <<asked, drawn>>
       [] asked < version          -> req' = "redirected" /\ asked' = version /\ UNCHANGED drawn
       [] OTHER                    -> req' = "reading" /\ UNCHANGED <<asked, drawn>>
  /\ UNCHANGED <<version, live, ended, endedAt, board, kept, shown>>

\* without OneRead: the second read takes the frame's document as it is now
ReadTheDocument ==
  /\ req = "reading"
  /\ IF live
       THEN req' = "drawing" /\ drawn' = version
       ELSE req' = "idle" /\ UNCHANGED drawn
  /\ UNCHANGED <<version, live, ended, endedAt, board, asked, kept, shown>>

\* the browser follows the redirect to the current address (no-store: the redirect is not kept)
FollowRedirect ==
  /\ req = "redirected"
  /\ IF kept[asked] # 0
       THEN /\ req' = "idle" /\ shown' = IF kept[asked] > shown THEN kept[asked] ELSE shown
       ELSE /\ req' = "asked" /\ UNCHANGED shown
  /\ UNCHANGED <<version, live, ended, endedAt, board, asked, drawn, kept>>

\* the draw ends; the server checks again that the frame or that kept version is there, and the
\* key, then answers
Answer ==
  /\ req = "drawing"
  /\ IF (live \/ held(asked)) /\ KeyOk
       THEN /\ req' = "sent" /\ kept' = [kept EXCEPT ![asked] = drawn]
       ELSE /\ req' = "idle" /\ UNCHANGED kept
  /\ drawn' = 0
  /\ UNCHANGED <<version, live, ended, endedAt, board, asked, shown>>

\* the tab shows the picture it got
Shown ==
  /\ req = "sent"
  /\ req' = "idle"
  /\ shown' = IF kept[asked] > shown THEN kept[asked] ELSE shown
  /\ UNCHANGED <<version, live, ended, endedAt, board, asked, drawn, kept>>

Write ==
  /\ live /\ version < MaxVersion
  /\ version' = version + 1
  /\ UNCHANGED <<live, ended, endedAt, board, req, asked, drawn, kept, shown>>

Delete ==
  /\ live
  /\ live' = FALSE
  /\ UNCHANGED <<version, ended, endedAt, board, req, asked, drawn, kept, shown>>

\* unshare, or a new password: the viewer's pass ends and the key generation goes up
EndLink ==
  /\ ~ended
  /\ ended' = TRUE /\ endedAt' = version
  /\ UNCHANGED <<version, live, board, req, asked, drawn, kept, shown>>

\* the tab is opened again in a browser with no copy kept
NewBrowser ==
  /\ req = "idle" /\ kept # [v \in 1..MaxVersion |-> 0]
  /\ kept' = [v \in 1..MaxVersion |-> 0]
  /\ UNCHANGED <<version, live, ended, endedAt, board, req, asked, drawn, shown>>

\* the end: the frame is deleted, the link has ended, and no request is out
Done ==
  /\ ~live /\ ended /\ req = "idle"
  /\ UNCHANGED vars

Next ==
  \/ Done
  \/ BoardCatchesUp \/ Ask \/ LookUp \/ ReadTheDocument \/ FollowRedirect \/ Answer \/ Shown
  \/ Write \/ Delete \/ EndLink \/ NewBrowser

Spec == Init /\ [][Next]_vars

\* ---------- rules, in the reader's words ----------

\* SPEC-frames.md, judged rule 7: a picture sent for an address shows the version that address
\* names.
APictureShowsTheVersionItsAddressNames == req = "sent" => kept[asked] = asked

\* SPEC-frames.md § Contract, Pictures (the current version): a copy kept (immutable) shows the
\* version its address names.
AKeptPictureShowsTheVersionItsAddressNames == \A v \in 1..MaxVersion : kept[v] \in {0, v}

\* SPEC-frames.md § Contract, Pictures (an older version), judged rule 7: the server draws only the
\* version the address names; an old version that is not kept is redirected, never drawn.
AnOldAddressIsRedirectedNotDrawn == req = "drawing" => drawn = asked

\* SPEC-frames.md § Contract, Pictures (a kept version), judged rule 16: a version that a request
\* refers to is drawn, never redirected.
AKeptVersionIsDrawnNotRedirected == [][(req = "asked" /\ req' = "redirected") => ~held(asked)]_vars

\* SPEC-frames.md § Contract, Pictures (a deleted frame), judged rules 7-8, 16: a deleted frame's
\* picture is sent only for a kept version: else the server answers 404, also when the delete
\* lands during the draw.
ADeletedFramesPictureIsSentOnlyIfKept ==
  [][(req # "sent" /\ req' = "sent") => live \/ held(asked)]_vars

\* SPEC-frames.md § Contract, Pictures (the key generation), judged rule 7: after the link ends, the
\* viewer sees no version newer than the one it could see then.
AnEndedViewerSeesNoNewerPicture == ended => shown <= endedAt

TypeOK ==
  /\ version \in 1..MaxVersion /\ board \in 0..MaxVersion
  /\ req \in {"idle", "asked", "redirected", "reading", "drawing", "sent"}
====
