# viewer: why the canvas looks at the target of a paste

This chart breaks on purpose. It is [viewer-image-drop](viewer-image-drop.md) with a canvas that
takes each paste of the page ([ImageDropAnyPaste.cfg](models/viewer/ImageDropAnyPaste.cfg)). A
person who pastes a screenshot into the textbox of a request (I2) then also gets a new frame on the
canvas. So the canvas takes a paste only when its target is not a text field, and the event is not
taken yet (SPEC-arrange.md rule 30). TLC finds `ATextPasteMakesNoFrame` broken in 1 step.

```mermaid
---
title: "viewer: a person drops or pastes an image on the canvas"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: viewer
    lg1: canvas
    lg2: going
    lg3: wrong
    lg4: Breaks ATextPasteMakesNoFrame
    lg5: Path to the ATextPasteMakesNoFrame bug
  }
  class lg0 tan
  class lg1 blue
  class lg2 yellow
  class lg3 pink
  class lg4 breaks
  class lg5 bugPath
  s0: The canvas
  s1: A share link: the canvas takes no image
  s2: An image goes at the place of the drop
  s3: The canvas, shows the hint for the drop
  s4: The canvas, says only an image of 10 MB at most goes
  s5: An image goes at the place of the paste
  s6: An image goes from the paste in the text field
  s7: An image goes at the place of the drop, shows the hint for the drop
  s8: An image goes at the place of the drop, says to wait for the image that goes
  s9: The canvas, says the image did not go
  s10: The canvas, a frame at the place of the drop
  s11: The canvas, a frame at the place of the paste
  s12: The canvas, a frame from the paste in the text field
  s13: The canvas, shows the hint for the drop, says only an image of 10 MB at most goes
  s14: An image goes at the place of the paste, shows the hint for the drop
  s15: An image goes at the place of the paste, says to wait for the image that goes
  s16: An image goes from the paste in the text field, shows the hint for the drop
  s17: An image goes from the paste in the text field, says to wait for the image that goes
  s18: An image goes at the place of the drop, a frame at the place of the drop
  s19: An image goes at the place of the drop, a frame at the place of the paste
  s20: An image goes at the place of the drop, a frame from the paste in the text field
  s21: An image goes at the place of the drop, shows the hint for the drop, says to wait for the image that goes
  s22: The canvas, shows the hint for the drop, says the image did not go
  s23: The canvas, shows the hint for the drop, a frame at the place of the drop
  s24: The canvas, shows the hint for the drop, a frame at the place of the paste
  s25: The canvas, shows the hint for the drop, a frame from the paste in the text field
  s26: The canvas, says only an image of 10 MB at most goes, a frame at the place of the drop
  s27: The canvas, says only an image of 10 MB at most goes, a frame at the place of the paste
  s28: The canvas, says only an image of 10 MB at most goes, a frame from the paste in the text field
  s29: An image goes at the place of the paste, a frame at the place of the drop
  s30: An image goes at the place of the paste, a frame at the place of the paste
  s31: An image goes at the place of the paste, a frame from the paste in the text field
  s32: An image goes at the place of the paste, shows the hint for the drop, says to wait for the image that goes
  s33: An image goes from the paste in the text field, a frame at the place of the drop
  s34: An image goes from the paste in the text field, a frame at the place of the paste
  s35: An image goes from the paste in the text field, a frame from the paste in the text field
  s36: An image goes from the paste in the text field, shows the hint for the drop, says to wait for the image that goes
  s37: An image goes at the place of the drop, shows the hint for the drop, a frame at the place of the drop
  s38: An image goes at the place of the drop, shows the hint for the drop, a frame at the place of the paste
  s39: An image goes at the place of the drop, shows the hint for the drop, a frame from the paste in the text field
  s40: An image goes at the place of the drop, says to wait for the image that goes, a frame at the place of the drop
  s41: An image goes at the place of the drop, says to wait for the image that goes, a frame at the place of the paste
  s42: An image goes at the place of the drop, says to wait for the image that goes, a frame from the paste in the text field
  s43: The canvas, says the image did not go, a frame at the place of the drop
  s44: The canvas, says the image did not go, a frame at the place of the paste
  s45: The canvas, says the image did not go, a frame from the paste in the text field
  s46: The canvas, shows the hint for the drop, says only an image of 10 MB at most goes, a frame at the place of the drop
  s47: The canvas, shows the hint for the drop, says only an image of 10 MB at most goes, a frame at the place of the paste
  s48: The canvas, shows the hint for the drop, says only an image of 10 MB at most goes, a frame from the paste in the text field
  s49: An image goes at the place of the paste, shows the hint for the drop, a frame at the place of the drop
  s50: An image goes at the place of the paste, shows the hint for the drop, a frame at the place of the paste
  s51: An image goes at the place of the paste, shows the hint for the drop, a frame from the paste in the text field
  s52: An image goes at the place of the paste, says to wait for the image that goes, a frame at the place of the drop
  s53: An image goes at the place of the paste, says to wait for the image that goes, a frame at the place of the paste
  s54: An image goes at the place of the paste, says to wait for the image that goes, a frame from the paste in the text field
  s55: An image goes from the paste in the text field, shows the hint for the drop, a frame at the place of the drop
  s56: An image goes from the paste in the text field, shows the hint for the drop, a frame at the place of the paste
  s57: An image goes from the paste in the text field, shows the hint for the drop, a frame from the paste in the text field
  s58: An image goes from the paste in the text field, says to wait for the image that goes, a frame at the place of the drop
  s59: An image goes from the paste in the text field, says to wait for the image that goes, a frame at the place of the paste
  s60: An image goes from the paste in the text field, says to wait for the image that goes, a frame from the paste in the text field
  s61: An image goes at the place of the drop, shows the hint for the drop, says to wait for the image that goes, a frame at the place of the drop
  s62: An image goes at the place of the drop, shows the hint for the drop, says to wait for the image that goes, a frame at the place of the paste
  s63: An image goes at the place of the drop, shows the hint for the drop, says to wait for the image that goes, a frame from the paste in the text field
  s64: The canvas, shows the hint for the drop, says the image did not go, a frame at the place of the drop
  s65: The canvas, shows the hint for the drop, says the image did not go, a frame at the place of the paste
  s66: The canvas, shows the hint for the drop, says the image did not go, a frame from the paste in the text field
  s67: An image goes at the place of the paste, shows the hint for the drop, says to wait for the image that goes, a frame at the place of the drop
  s68: An image goes at the place of the paste, shows the hint for the drop, says to wait for the image that goes, a frame at the place of the paste
  s69: An image goes at the place of the paste, shows the hint for the drop, says to wait for the image that goes, a frame from the paste in the text field
  s70: An image goes from the paste in the text field, shows the hint for the drop, says to wait for the image that goes, a frame at the place of the drop
  s71: An image goes from the paste in the text field, shows the hint for the drop, says to wait for the image that goes, a frame at the place of the paste
  s72: An image goes from the paste in the text field, shows the hint for the drop, says to wait for the image that goes, a frame from the paste in the text field
  [*] --> s0
  [*] --> s1
  s0 --> s2: a drop of an image
  s0 --> s3: a file comes over the canvas
  s0 --> s4: a drop of another file, or over 10 MB or a paste of another file
  s0 --> s5: a paste of an image on the canvas
  s0 --> s6: a paste in a text field: the canvas takes it
  s2 --> s4: put answers badImage or tooBig
  s2 --> s7: a file comes over the canvas
  s2 --> s8: a drop while an image goes or a paste while an image goes
  s2 --> s9: the socket is lost
  s2 --> s10: put answers created
  s3 --> s0: the file goes off the canvas
  s3 --> s2: a drop of an image
  s3 --> s4: a drop of another file, or over 10 MB
  s3 --> s13: a paste of another file
  s3 --> s14: a paste of an image on the canvas
  s3 --> s16: a paste in a text field: the canvas takes it
  s4 --> s2: a drop of an image
  s4 --> s5: a paste of an image on the canvas
  s4 --> s6: a paste in a text field: the canvas takes it
  s4 --> s13: a file comes over the canvas
  s5 --> s4: put answers badImage or tooBig
  s5 --> s9: the socket is lost
  s5 --> s11: put answers created
  s5 --> s14: a file comes over the canvas
  s5 --> s15: a drop while an image goes or a paste while an image goes
  s6 --> s4: put answers badImage or tooBig
  s6 --> s9: the socket is lost
  s6 --> s12: put answers created
  s6 --> s16: a file comes over the canvas
  s6 --> s17: a drop while an image goes or a paste while an image goes
  s7 --> s2: the file goes off the canvas
  s7 --> s8: a drop while an image goes
  s7 --> s13: put answers badImage or tooBig
  s7 --> s21: a paste while an image goes
  s7 --> s22: the socket is lost
  s7 --> s23: put answers created
  s8 --> s4: put answers badImage or tooBig
  s8 --> s9: the socket is lost
  s8 --> s10: put answers created
  s8 --> s21: a file comes over the canvas
  s9 --> s2: a drop of an image
  s9 --> s4: a drop of another file, or over 10 MB or a paste of another file
  s9 --> s5: a paste of an image on the canvas
  s9 --> s6: a paste in a text field: the canvas takes it
  s9 --> s22: a file comes over the canvas
  s10 --> s18: a drop of an image
  s10 --> s23: a file comes over the canvas
  s10 --> s26: a drop of another file, or over 10 MB or a paste of another file
  s10 --> s29: a paste of an image on the canvas
  s10 --> s33: a paste in a text field: the canvas takes it
  s11 --> s19: a drop of an image
  s11 --> s24: a file comes over the canvas
  s11 --> s27: a drop of another file, or over 10 MB or a paste of another file
  s11 --> s30: a paste of an image on the canvas
  s11 --> s34: a paste in a text field: the canvas takes it
  s12 --> s20: a drop of an image
  s12 --> s25: a file comes over the canvas
  s12 --> s28: a drop of another file, or over 10 MB or a paste of another file
  s12 --> s31: a paste of an image on the canvas
  s12 --> s35: a paste in a text field: the canvas takes it
  s13 --> s2: a drop of an image
  s13 --> s4: a drop of another file, or over 10 MB or the file goes off the canvas
  s13 --> s14: a paste of an image on the canvas
  s13 --> s16: a paste in a text field: the canvas takes it
  s14 --> s5: the file goes off the canvas
  s14 --> s13: put answers badImage or tooBig
  s14 --> s15: a drop while an image goes
  s14 --> s22: the socket is lost
  s14 --> s24: put answers created
  s14 --> s32: a paste while an image goes
  s15 --> s4: put answers badImage or tooBig
  s15 --> s9: the socket is lost
  s15 --> s11: put answers created
  s15 --> s32: a file comes over the canvas
  s16 --> s6: the file goes off the canvas
  s16 --> s13: put answers badImage or tooBig
  s16 --> s17: a drop while an image goes
  s16 --> s22: the socket is lost
  s16 --> s25: put answers created
  s16 --> s36: a paste while an image goes
  s17 --> s4: put answers badImage or tooBig
  s17 --> s9: the socket is lost
  s17 --> s12: put answers created
  s17 --> s36: a file comes over the canvas
  s18 --> s10: put answers created
  s18 --> s26: put answers badImage or tooBig
  s18 --> s37: a file comes over the canvas
  s18 --> s40: a drop while an image goes or a paste while an image goes
  s18 --> s43: the socket is lost
  s19 --> s10: put answers created
  s19 --> s27: put answers badImage or tooBig
  s19 --> s38: a file comes over the canvas
  s19 --> s41: a drop while an image goes or a paste while an image goes
  s19 --> s44: the socket is lost
  s20 --> s10: put answers created
  s20 --> s28: put answers badImage or tooBig
  s20 --> s39: a file comes over the canvas
  s20 --> s42: a drop while an image goes or a paste while an image goes
  s20 --> s45: the socket is lost
  s21 --> s8: a drop while an image goes or the file goes off the canvas
  s21 --> s13: put answers badImage or tooBig
  s21 --> s22: the socket is lost
  s21 --> s23: put answers created
  s22 --> s2: a drop of an image
  s22 --> s4: a drop of another file, or over 10 MB
  s22 --> s9: the file goes off the canvas
  s22 --> s13: a paste of another file
  s22 --> s14: a paste of an image on the canvas
  s22 --> s16: a paste in a text field: the canvas takes it
  s23 --> s10: the file goes off the canvas
  s23 --> s18: a drop of an image
  s23 --> s26: a drop of another file, or over 10 MB
  s23 --> s46: a paste of another file
  s23 --> s49: a paste of an image on the canvas
  s23 --> s55: a paste in a text field: the canvas takes it
  s24 --> s11: the file goes off the canvas
  s24 --> s19: a drop of an image
  s24 --> s27: a drop of another file, or over 10 MB
  s24 --> s47: a paste of another file
  s24 --> s50: a paste of an image on the canvas
  s24 --> s56: a paste in a text field: the canvas takes it
  s25 --> s12: the file goes off the canvas
  s25 --> s20: a drop of an image
  s25 --> s28: a drop of another file, or over 10 MB
  s25 --> s48: a paste of another file
  s25 --> s51: a paste of an image on the canvas
  s25 --> s57: a paste in a text field: the canvas takes it
  s26 --> s18: a drop of an image
  s26 --> s29: a paste of an image on the canvas
  s26 --> s33: a paste in a text field: the canvas takes it
  s26 --> s46: a file comes over the canvas
  s27 --> s19: a drop of an image
  s27 --> s30: a paste of an image on the canvas
  s27 --> s34: a paste in a text field: the canvas takes it
  s27 --> s47: a file comes over the canvas
  s28 --> s20: a drop of an image
  s28 --> s31: a paste of an image on the canvas
  s28 --> s35: a paste in a text field: the canvas takes it
  s28 --> s48: a file comes over the canvas
  s29 --> s11: put answers created
  s29 --> s26: put answers badImage or tooBig
  s29 --> s43: the socket is lost
  s29 --> s49: a file comes over the canvas
  s29 --> s52: a drop while an image goes or a paste while an image goes
  s30 --> s11: put answers created
  s30 --> s27: put answers badImage or tooBig
  s30 --> s44: the socket is lost
  s30 --> s50: a file comes over the canvas
  s30 --> s53: a drop while an image goes or a paste while an image goes
  s31 --> s11: put answers created
  s31 --> s28: put answers badImage or tooBig
  s31 --> s45: the socket is lost
  s31 --> s51: a file comes over the canvas
  s31 --> s54: a drop while an image goes or a paste while an image goes
  s32 --> s13: put answers badImage or tooBig
  s32 --> s15: a drop while an image goes or the file goes off the canvas
  s32 --> s22: the socket is lost
  s32 --> s24: put answers created
  s33 --> s12: put answers created
  s33 --> s26: put answers badImage or tooBig
  s33 --> s43: the socket is lost
  s33 --> s55: a file comes over the canvas
  s33 --> s58: a drop while an image goes or a paste while an image goes
  s34 --> s12: put answers created
  s34 --> s27: put answers badImage or tooBig
  s34 --> s44: the socket is lost
  s34 --> s56: a file comes over the canvas
  s34 --> s59: a drop while an image goes or a paste while an image goes
  s35 --> s12: put answers created
  s35 --> s28: put answers badImage or tooBig
  s35 --> s45: the socket is lost
  s35 --> s57: a file comes over the canvas
  s35 --> s60: a drop while an image goes or a paste while an image goes
  s36 --> s13: put answers badImage or tooBig
  s36 --> s17: a drop while an image goes or the file goes off the canvas
  s36 --> s22: the socket is lost
  s36 --> s25: put answers created
  s37 --> s18: the file goes off the canvas
  s37 --> s23: put answers created
  s37 --> s40: a drop while an image goes
  s37 --> s46: put answers badImage or tooBig
  s37 --> s61: a paste while an image goes
  s37 --> s64: the socket is lost
  s38 --> s19: the file goes off the canvas
  s38 --> s23: put answers created
  s38 --> s41: a drop while an image goes
  s38 --> s47: put answers badImage or tooBig
  s38 --> s62: a paste while an image goes
  s38 --> s65: the socket is lost
  s39 --> s20: the file goes off the canvas
  s39 --> s23: put answers created
  s39 --> s42: a drop while an image goes
  s39 --> s48: put answers badImage or tooBig
  s39 --> s63: a paste while an image goes
  s39 --> s66: the socket is lost
  s40 --> s10: put answers created
  s40 --> s26: put answers badImage or tooBig
  s40 --> s43: the socket is lost
  s40 --> s61: a file comes over the canvas
  s41 --> s10: put answers created
  s41 --> s27: put answers badImage or tooBig
  s41 --> s44: the socket is lost
  s41 --> s62: a file comes over the canvas
  s42 --> s10: put answers created
  s42 --> s28: put answers badImage or tooBig
  s42 --> s45: the socket is lost
  s42 --> s63: a file comes over the canvas
  s43 --> s18: a drop of an image
  s43 --> s26: a drop of another file, or over 10 MB or a paste of another file
  s43 --> s29: a paste of an image on the canvas
  s43 --> s33: a paste in a text field: the canvas takes it
  s43 --> s64: a file comes over the canvas
  s44 --> s19: a drop of an image
  s44 --> s27: a drop of another file, or over 10 MB or a paste of another file
  s44 --> s30: a paste of an image on the canvas
  s44 --> s34: a paste in a text field: the canvas takes it
  s44 --> s65: a file comes over the canvas
  s45 --> s20: a drop of an image
  s45 --> s28: a drop of another file, or over 10 MB or a paste of another file
  s45 --> s31: a paste of an image on the canvas
  s45 --> s35: a paste in a text field: the canvas takes it
  s45 --> s66: a file comes over the canvas
  s46 --> s18: a drop of an image
  s46 --> s26: a drop of another file, or over 10 MB or the file goes off the canvas
  s46 --> s49: a paste of an image on the canvas
  s46 --> s55: a paste in a text field: the canvas takes it
  s47 --> s19: a drop of an image
  s47 --> s27: a drop of another file, or over 10 MB or the file goes off the canvas
  s47 --> s50: a paste of an image on the canvas
  s47 --> s56: a paste in a text field: the canvas takes it
  s48 --> s20: a drop of an image
  s48 --> s28: a drop of another file, or over 10 MB or the file goes off the canvas
  s48 --> s51: a paste of an image on the canvas
  s48 --> s57: a paste in a text field: the canvas takes it
  s49 --> s24: put answers created
  s49 --> s29: the file goes off the canvas
  s49 --> s46: put answers badImage or tooBig
  s49 --> s52: a drop while an image goes
  s49 --> s64: the socket is lost
  s49 --> s67: a paste while an image goes
  s50 --> s24: put answers created
  s50 --> s30: the file goes off the canvas
  s50 --> s47: put answers badImage or tooBig
  s50 --> s53: a drop while an image goes
  s50 --> s65: the socket is lost
  s50 --> s68: a paste while an image goes
  s51 --> s24: put answers created
  s51 --> s31: the file goes off the canvas
  s51 --> s48: put answers badImage or tooBig
  s51 --> s54: a drop while an image goes
  s51 --> s66: the socket is lost
  s51 --> s69: a paste while an image goes
  s52 --> s11: put answers created
  s52 --> s26: put answers badImage or tooBig
  s52 --> s43: the socket is lost
  s52 --> s67: a file comes over the canvas
  s53 --> s11: put answers created
  s53 --> s27: put answers badImage or tooBig
  s53 --> s44: the socket is lost
  s53 --> s68: a file comes over the canvas
  s54 --> s11: put answers created
  s54 --> s28: put answers badImage or tooBig
  s54 --> s45: the socket is lost
  s54 --> s69: a file comes over the canvas
  s55 --> s25: put answers created
  s55 --> s33: the file goes off the canvas
  s55 --> s46: put answers badImage or tooBig
  s55 --> s58: a drop while an image goes
  s55 --> s64: the socket is lost
  s55 --> s70: a paste while an image goes
  s56 --> s25: put answers created
  s56 --> s34: the file goes off the canvas
  s56 --> s47: put answers badImage or tooBig
  s56 --> s59: a drop while an image goes
  s56 --> s65: the socket is lost
  s56 --> s71: a paste while an image goes
  s57 --> s25: put answers created
  s57 --> s35: the file goes off the canvas
  s57 --> s48: put answers badImage or tooBig
  s57 --> s60: a drop while an image goes
  s57 --> s66: the socket is lost
  s57 --> s72: a paste while an image goes
  s58 --> s12: put answers created
  s58 --> s26: put answers badImage or tooBig
  s58 --> s43: the socket is lost
  s58 --> s70: a file comes over the canvas
  s59 --> s12: put answers created
  s59 --> s27: put answers badImage or tooBig
  s59 --> s44: the socket is lost
  s59 --> s71: a file comes over the canvas
  s60 --> s12: put answers created
  s60 --> s28: put answers badImage or tooBig
  s60 --> s45: the socket is lost
  s60 --> s72: a file comes over the canvas
  s61 --> s23: put answers created
  s61 --> s40: a drop while an image goes or the file goes off the canvas
  s61 --> s46: put answers badImage or tooBig
  s61 --> s64: the socket is lost
  s62 --> s23: put answers created
  s62 --> s41: a drop while an image goes or the file goes off the canvas
  s62 --> s47: put answers badImage or tooBig
  s62 --> s65: the socket is lost
  s63 --> s23: put answers created
  s63 --> s42: a drop while an image goes or the file goes off the canvas
  s63 --> s48: put answers badImage or tooBig
  s63 --> s66: the socket is lost
  s64 --> s18: a drop of an image
  s64 --> s26: a drop of another file, or over 10 MB
  s64 --> s43: the file goes off the canvas
  s64 --> s46: a paste of another file
  s64 --> s49: a paste of an image on the canvas
  s64 --> s55: a paste in a text field: the canvas takes it
  s65 --> s19: a drop of an image
  s65 --> s27: a drop of another file, or over 10 MB
  s65 --> s44: the file goes off the canvas
  s65 --> s47: a paste of another file
  s65 --> s50: a paste of an image on the canvas
  s65 --> s56: a paste in a text field: the canvas takes it
  s66 --> s20: a drop of an image
  s66 --> s28: a drop of another file, or over 10 MB
  s66 --> s45: the file goes off the canvas
  s66 --> s48: a paste of another file
  s66 --> s51: a paste of an image on the canvas
  s66 --> s57: a paste in a text field: the canvas takes it
  s67 --> s24: put answers created
  s67 --> s46: put answers badImage or tooBig
  s67 --> s52: a drop while an image goes or the file goes off the canvas
  s67 --> s64: the socket is lost
  s68 --> s24: put answers created
  s68 --> s47: put answers badImage or tooBig
  s68 --> s53: a drop while an image goes or the file goes off the canvas
  s68 --> s65: the socket is lost
  s69 --> s24: put answers created
  s69 --> s48: put answers badImage or tooBig
  s69 --> s54: a drop while an image goes or the file goes off the canvas
  s69 --> s66: the socket is lost
  s70 --> s25: put answers created
  s70 --> s46: put answers badImage or tooBig
  s70 --> s58: a drop while an image goes or the file goes off the canvas
  s70 --> s64: the socket is lost
  s71 --> s25: put answers created
  s71 --> s47: put answers badImage or tooBig
  s71 --> s59: a drop while an image goes or the file goes off the canvas
  s71 --> s65: the socket is lost
  s72 --> s25: put answers created
  s72 --> s48: put answers badImage or tooBig
  s72 --> s60: a drop while an image goes or the file goes off the canvas
  s72 --> s66: the socket is lost
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  class s0 blue
  class s0 bugPath
  class s1 tan
  class s2 yellow
  class s3 blue
  class s4 blue
  class s5 yellow
  class s6 pink
  class s6 breaks
  class s6 bugPath
  class s7 yellow
  class s8 yellow
  class s9 blue
  class s10 blue
  class s11 blue
  class s12 pink
  class s12 breaks
  class s13 blue
  class s14 yellow
  class s15 yellow
  class s16 pink
  class s16 breaks
  class s17 pink
  class s17 breaks
  class s18 yellow
  class s19 yellow
  class s20 pink
  class s20 breaks
  class s21 yellow
  class s22 blue
  class s23 blue
  class s24 blue
  class s25 pink
  class s25 breaks
  class s26 blue
  class s27 blue
  class s28 pink
  class s28 breaks
  class s29 yellow
  class s30 yellow
  class s31 pink
  class s31 breaks
  class s32 yellow
  class s33 pink
  class s33 breaks
  class s34 pink
  class s34 breaks
  class s35 pink
  class s35 breaks
  class s36 pink
  class s36 breaks
  class s37 yellow
  class s38 yellow
  class s39 pink
  class s39 breaks
  class s40 yellow
  class s41 yellow
  class s42 pink
  class s42 breaks
  class s43 blue
  class s44 blue
  class s45 pink
  class s45 breaks
  class s46 blue
  class s47 blue
  class s48 pink
  class s48 breaks
  class s49 yellow
  class s50 yellow
  class s51 pink
  class s51 breaks
  class s52 yellow
  class s53 yellow
  class s54 pink
  class s54 breaks
  class s55 pink
  class s55 breaks
  class s56 pink
  class s56 breaks
  class s57 pink
  class s57 breaks
  class s58 pink
  class s58 breaks
  class s59 pink
  class s59 breaks
  class s60 pink
  class s60 breaks
  class s61 yellow
  class s62 yellow
  class s63 pink
  class s63 breaks
  class s64 blue
  class s65 blue
  class s66 pink
  class s66 breaks
  class s67 yellow
  class s68 yellow
  class s69 pink
  class s69 breaks
  class s70 pink
  class s70 breaks
  class s71 pink
  class s71 breaks
  class s72 pink
  class s72 breaks
```

| Rule                     | In plain words                                             | Verdict |
| ------------------------ | ---------------------------------------------------------- | ------- |
| `ATextPasteMakesNoFrame` | A paste into a text field never makes a frame.             | breaks  |
| `AViewerNeverWrites`     | A viewer of a share link makes no frame.                   | holds   |
| `OneAtATime`             | A drop or a paste while an image goes does not replace it. | holds   |
