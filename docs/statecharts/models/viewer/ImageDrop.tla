---- MODULE ImageDrop ----
\* SPEC-arrange.md rules 29 to 34 (E2.4 I3): a person drops or pastes an image on the canvas, and
\* it becomes an image frame at that place. Only a signed-in member on `/c/<canvas>` can do it; a
\* viewer of a share link cannot (SPEC-frames fact rule 7). A drop goes at the place of the drop. A
\* paste goes at the pointer when the pointer is on the canvas, else in the middle of the view. A
\* paste into a text field (the textbox of a request, I2) goes to that field. One image goes at a
\* time. A file that is not an image of at most 10 MiB, an image that the server refuses, and a lost
\* socket make no frame, and the page says why.
\* AnyPaste = TRUE is a canvas that takes each paste of the page (chart viewer-image-drop-any-paste):
\* it also takes the paste that was for the textbox of a request.
EXTENDS Naturals

CONSTANT AnyPaste

Places == {"drop", "paste"}

VARIABLES
  who,    \* "member" (on /c/<canvas>) or "viewer" (on a share link)
  over,   \* a file is over the canvas, and the canvas shows the hint
  going,  \* the place of the image that goes now, "text" for a paste of a text field, or "none"
  told,   \* what the page says: "none", "refused", "wait" or "lost"
  made    \* the place of the last frame that an image made, or "none"

vars == <<who, over, going, told, made>>

Init ==
  /\ who \in {"member", "viewer"} /\ over = FALSE
  /\ going = "none" /\ told = "none" /\ made = "none"

Member == who = "member"

FileIn ==
  /\ Member /\ ~over
  /\ over' = TRUE
  /\ UNCHANGED <<who, going, told, made>>

FileOut ==
  /\ over
  /\ over' = FALSE
  /\ UNCHANGED <<who, going, told, made>>

\* An image, or a file that the page takes as one, starts to go at a place.
Start(p, image) ==
  IF going # "none" THEN going' = going /\ told' = "wait"
  ELSE IF image THEN going' = p /\ told' = "none"
  ELSE going' = going /\ told' = "refused"

Drop(image) ==
  /\ Member
  /\ over' = FALSE
  /\ Start("drop", image)
  /\ UNCHANGED <<who, made>>

\* The place is the pointer when the pointer is on the canvas, else the middle of the view.
PasteOnCanvas(image) ==
  /\ Member
  /\ Start("paste", image)
  /\ UNCHANGED <<who, over, made>>

\* A paste into a text field goes to the field, and changes nothing here. Only with AnyPaste does the
\* canvas take it too.
PasteInText ==
  /\ Member /\ AnyPaste /\ going = "none"
  /\ going' = "text" /\ told' = "none"
  /\ UNCHANGED <<who, over, made>>

\* On a share link, a drop or a paste on the canvas changes nothing.
ViewerDrop ==
  /\ who = "viewer"
  /\ UNCHANGED vars

\* `frame.put` answers created: the frame is at the place that went with the image.
Created ==
  /\ going # "none"
  /\ made' = going /\ going' = "none" /\ told' = "none"
  /\ UNCHANGED <<who, over>>

\* `badImage` or `tooBig`.
Refused ==
  /\ going # "none"
  /\ going' = "none" /\ told' = "refused"
  /\ UNCHANGED <<who, over, made>>

Lost ==
  /\ going # "none"
  /\ going' = "none" /\ told' = "lost"
  /\ UNCHANGED <<who, over, made>>

Next ==
  \/ FileIn \/ FileOut \/ Drop(TRUE) \/ Drop(FALSE)
  \/ PasteOnCanvas(TRUE) \/ PasteOnCanvas(FALSE)
  \/ PasteInText
  \/ Created \/ Refused \/ Lost \/ ViewerDrop

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ who \in {"member", "viewer"} /\ over \in BOOLEAN
  /\ going \in Places \cup {"text", "none"}
  /\ told \in {"none", "refused", "wait", "lost"}
  /\ made \in Places \cup {"text", "none"}

\* A viewer never makes a frame, and sees no hint.
AViewerNeverWrites == who = "viewer" => (going = "none" /\ made = "none" /\ ~over)

\* A paste into a text field never makes a frame.
ATextPasteMakesNoFrame == going # "text" /\ made # "text"

\* One image goes at a time: a drop or a paste while one goes does not replace it.
OneAtATime == [][(going # "none" /\ going' # "none") => going' = going]_vars

\* The frame is at the place of its drop or paste.
TheFrameIsWhereItWent == [][(made' # made /\ going # "none") => made' = going]_vars

\* A refusal or a lost socket makes no frame.
ARefusalMakesNoFrame == [][(told' \in {"refused", "lost"} /\ told' # told) => made' = made]_vars
====
