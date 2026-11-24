---- MODULE RequestShot ----
\* SPEC-queue.md § A screenshot on a request (D9-2 of the design loop, SPEC-design-loop.md rule 10):
\* the textbox of a request holds at most one screenshot. A person pastes an image into it, or
\* presses `Take a part` and drags a box on the frame of the request. A second screenshot replaces
\* the first. Escape in the pick ends the pick only, and keeps the text and the screenshot. `Send`
\* sends the text and the screenshot in one call, and the request keeps both. A paste that is not
\* a PNG, JPEG or WebP of at most 10 MiB, or an image that the server refuses, never goes with the
\* request: the textbox keeps the text and says why. Prior art: GitHub and Linear take one pasted
\* image into a comment box, and show it before the send.
EXTENDS Naturals

Shots == {"none", "image", "region"}

VARIABLES
  draft,    \* "none", "typing" or "sending"
  onFrame,  \* the request is on a frame (else on the canvas: no part of a frame to take)
  picking,  \* the person drags a box on the frame of the request
  shot,     \* the screenshot in the textbox
  told,     \* "none" or "refused": the textbox says that a screenshot was refused
  saved     \* the screenshot of the request that the server saved, or "no request"

vars == <<draft, onFrame, picking, shot, told, saved>>

TypeOK ==
  /\ draft \in {"none", "typing", "sending"}
  /\ onFrame \in BOOLEAN
  /\ picking \in BOOLEAN
  /\ shot \in Shots
  /\ told \in {"none", "refused"}
  /\ saved \in Shots \cup {"no request"}

Init ==
  /\ draft = "none" /\ onFrame \in BOOLEAN /\ picking = FALSE /\ shot = "none"
  /\ told = "none" /\ saved = "no request"

Typing == draft = "typing" /\ ~picking

\* A click on a frame or on the canvas opens the textbox, with no screenshot.
Open(frame) ==
  /\ draft = "none" /\ saved = "no request"
  /\ draft' = "typing" /\ onFrame' = frame /\ shot' = "none" /\ told' = "none"
  /\ UNCHANGED <<picking, saved>>

\* A paste of a PNG, JPEG or WebP of at most 10 MiB: it is the screenshot, and replaces the one before.
PasteImage ==
  /\ Typing
  /\ shot' = "image" /\ told' = "none"
  /\ UNCHANGED <<draft, onFrame, picking, saved>>

\* A paste of another file, or of an image over 10 MiB: the textbox says so, and the screenshot stays.
PasteRefused ==
  /\ Typing
  /\ told' = "refused"
  /\ UNCHANGED <<draft, onFrame, picking, shot, saved>>

\* `Take a part`: only a request on a frame has a part of a frame to take.
StartPick ==
  /\ Typing /\ onFrame
  /\ picking' = TRUE
  /\ UNCHANGED <<draft, onFrame, shot, told, saved>>

\* The person drags a box on the frame: the box is the screenshot, and replaces the one before.
Pick ==
  /\ picking
  /\ picking' = FALSE /\ shot' = "region" /\ told' = "none"
  /\ UNCHANGED <<draft, onFrame, saved>>

\* Escape in the pick ends the pick only: the text and the screenshot stay.
EndPick ==
  /\ picking
  /\ picking' = FALSE
  /\ UNCHANGED <<draft, onFrame, shot, told, saved>>

\* The button that removes the screenshot.
Remove ==
  /\ Typing /\ shot # "none"
  /\ shot' = "none"
  /\ UNCHANGED <<draft, onFrame, picking, told, saved>>

Send ==
  /\ Typing
  /\ draft' = "sending"
  /\ UNCHANGED <<onFrame, picking, shot, told, saved>>

\* The server saves the request with the screenshot that the textbox held.
Added ==
  /\ draft = "sending"
  /\ draft' = "none" /\ saved' = shot /\ shot' = "none" /\ told' = "none"
  /\ UNCHANGED <<onFrame, picking>>

\* The server refuses the image (badImage or tooBig): nothing is saved, the text stays, the
\* screenshot goes, and the textbox says why.
Refused ==
  /\ draft = "sending" /\ shot = "image"
  /\ draft' = "typing" /\ shot' = "none" /\ told' = "refused"
  /\ UNCHANGED <<onFrame, picking, saved>>

\* Escape or Cancel out of the pick closes the textbox, and sends nothing.
Cancel ==
  /\ Typing
  /\ draft' = "none" /\ shot' = "none" /\ told' = "none"
  /\ UNCHANGED <<onFrame, picking, saved>>

Done ==
  /\ saved # "no request" /\ draft = "none"
  /\ UNCHANGED vars

Next ==
  \/ Open(TRUE) \/ Open(FALSE)
  \/ PasteImage \/ PasteRefused \/ StartPick \/ Pick \/ EndPick \/ Remove
  \/ Send \/ Added \/ Refused \/ Cancel \/ Done

Spec == Init /\ [][Next]_vars

\* The pick of a part is only on the frame of the request, and only while the textbox is open.
PickOnlyOnAFrame == picking => (onFrame /\ draft = "typing")

\* No send while a pick is on: the screenshot that goes is the one that the textbox shows.
NoSendWhilePicking == draft = "sending" => ~picking

\* The request keeps the screenshot that the textbox held at Send, and only that one.
SavedIsWhatWasShown == [][(saved = "no request" /\ saved' # "no request") => saved' = shot]_vars

\* Escape in the pick keeps the textbox and its screenshot.
EscapeInPickKeepsTheDraft ==
  [][(picking /\ ~picking' /\ shot' = shot) => (draft' = draft /\ shot' = shot)]_vars

\* A refused screenshot never goes with a request.
RefusedIsNeverSaved == told = "refused" => saved = "no request"
====
