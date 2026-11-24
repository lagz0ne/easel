# viewer: why the walk takes only an action name from the frame

This chart breaks on purpose. It is [viewer-walk](viewer-walk.md) with a viewer that goes to the
screen that the frame names ([WalkAnyPost.cfg](models/viewer/WalkAnyPost.cfg),
`TrustFramePost = TRUE`). A frame is code of an agent. If the viewer takes a screen from it, a
frame shows a screen that no link reaches, such as screen x, and the map and `flow check` do not
show that step. So the frame posts only the name of an action, and the viewer finds the next screen
in the links of the canvas ([SPEC-flows](../../SPEC-flows.md) decision 5, fact rule 3). TLC finds
`EachStepIsALink` broken in 2 steps.

```mermaid
---
title: "viewer: the person walks a flow in walk mode"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: canvas
    lg1: walk
    lg2: request
    lg3: Breaks EachStepIsALink
    lg4: Path to the EachStepIsALink bug
  }
  class lg0 tan
  class lg1 teal
  class lg2 blue
  class lg3 breaks
  class lg4 bugPath
  s0: The canvas
  s1: Walk: screen a (the first step)
  s2: Walk: screen a (steps: a, a)
  s3: Walk: screen b (steps: a, b)
  s4: Walk: screen c (steps: a, c)
  s5: Walk: screen x (steps: a, x)
  s6: Walk: screen a (the first step), Comment on
  s7: Walk: screen c (steps: a, c), the bar says no screen comes after done
  s8: Walk: screen a (steps: a, a, a)
  s9: Walk: screen b (steps: a, a, b)
  s10: Walk: screen c (steps: a, a, c)
  s11: Walk: screen x (steps: a, a, x)
  s12: Walk: screen a (steps: a, a), Comment on
  s13: Walk: screen a (steps: a, b, a)
  s14: Walk: screen b (steps: a, b, b)
  s15: Walk: screen c (steps: a, b, c)
  s16: Walk: screen x (steps: a, b, x)
  s17: Walk: screen b (steps: a, b), Comment on
  s18: Walk: screen a (steps: a, c, a)
  s19: Walk: screen b (steps: a, c, b)
  s20: Walk: screen c (steps: a, c, c)
  s21: Walk: screen x (steps: a, c, x)
  s22: Walk: screen c (steps: a, c), Comment on
  s23: Walk: screen a (steps: a, x, a)
  s24: Walk: screen b (steps: a, x, b)
  s25: Walk: screen c (steps: a, x, c)
  s26: Walk: screen x (steps: a, x, x)
  s27: Walk: screen x (steps: a, x), Comment on
  s28: Walk: screen a (the first step), a request open on the screen
  s29: Walk: screen c (steps: a, a, c), the bar says no screen comes after done
  s30: Walk: screen c (steps: a, b, c), the bar says no screen comes after done
  s31: Walk: screen c (steps: a, c, c), the bar says no screen comes after done
  s32: Walk: screen c (steps: a, c), the bar says no screen comes after done, Comment on
  s33: Walk: screen c (steps: a, x, c), the bar says no screen comes after done
  s34: Walk: screen a (steps: a, a, a), Comment on
  s35: Walk: screen b (steps: a, a, b), Comment on
  s36: Walk: screen c (steps: a, a, c), Comment on
  s37: Walk: screen x (steps: a, a, x), Comment on
  s38: Walk: screen a (steps: a, a), a request open on the screen
  s39: Walk: screen a (steps: a, b, a), Comment on
  s40: Walk: screen b (steps: a, b, b), Comment on
  s41: Walk: screen c (steps: a, b, c), Comment on
  s42: Walk: screen x (steps: a, b, x), Comment on
  s43: Walk: screen b (steps: a, b), a request open on the screen
  s44: Walk: screen a (steps: a, c, a), Comment on
  s45: Walk: screen b (steps: a, c, b), Comment on
  s46: Walk: screen c (steps: a, c, c), Comment on
  s47: Walk: screen x (steps: a, c, x), Comment on
  s48: Walk: screen c (steps: a, c), a request open on the screen
  s49: Walk: screen a (steps: a, x, a), Comment on
  s50: Walk: screen b (steps: a, x, b), Comment on
  s51: Walk: screen c (steps: a, x, c), Comment on
  s52: Walk: screen x (steps: a, x, x), Comment on
  s53: Walk: screen x (steps: a, x), a request open on the screen
  s54: Walk: screen c (steps: a, a, c), the bar says no screen comes after done, Comment on
  s55: Walk: screen c (steps: a, b, c), the bar says no screen comes after done, Comment on
  s56: Walk: screen c (steps: a, c, c), the bar says no screen comes after done, Comment on
  s57: Walk: screen c (steps: a, c), the bar says no screen comes after done, a request open on the screen
  s58: Walk: screen c (steps: a, x, c), the bar says no screen comes after done, Comment on
  s59: Walk: screen a (steps: a, a, a), a request open on the screen
  s60: Walk: screen b (steps: a, a, b), a request open on the screen
  s61: Walk: screen c (steps: a, a, c), a request open on the screen
  s62: Walk: screen x (steps: a, a, x), a request open on the screen
  s63: Walk: screen a (steps: a, b, a), a request open on the screen
  s64: Walk: screen b (steps: a, b, b), a request open on the screen
  s65: Walk: screen c (steps: a, b, c), a request open on the screen
  s66: Walk: screen x (steps: a, b, x), a request open on the screen
  s67: Walk: screen a (steps: a, c, a), a request open on the screen
  s68: Walk: screen b (steps: a, c, b), a request open on the screen
  s69: Walk: screen c (steps: a, c, c), a request open on the screen
  s70: Walk: screen x (steps: a, c, x), a request open on the screen
  s71: Walk: screen a (steps: a, x, a), a request open on the screen
  s72: Walk: screen b (steps: a, x, b), a request open on the screen
  s73: Walk: screen c (steps: a, x, c), a request open on the screen
  s74: Walk: screen x (steps: a, x, x), a request open on the screen
  s75: Walk: screen c (steps: a, a, c), the bar says no screen comes after done, a request open on the screen
  s76: Walk: screen c (steps: a, b, c), the bar says no screen comes after done, a request open on the screen
  s77: Walk: screen c (steps: a, c, c), the bar says no screen comes after done, a request open on the screen
  s78: Walk: screen c (steps: a, x, c), the bar says no screen comes after done, a request open on the screen
  [*] --> s0
  s0 --> s1: a press on the mark of the flow, or on the flow in the menu
  s1 --> s0: Escape: the walk ends or Leave
  s1 --> s2: the frame posts screen a
  s1 --> s3: the frame posts screen b or a press on an action: screen b
  s1 --> s4: the frame posts screen c
  s1 --> s5: the frame posts screen x
  s1 --> s6: Comment
  s2 --> s0: Escape: the walk ends or Leave
  s2 --> s1: Back or Restart
  s2 --> s8: the frame posts screen a
  s2 --> s9: the frame posts screen b or a press on an action: screen b
  s2 --> s10: the frame posts screen c
  s2 --> s11: the frame posts screen x
  s2 --> s12: Comment
  s3 --> s0: Escape: the walk ends or Leave
  s3 --> s1: Back or Restart
  s3 --> s13: the frame posts screen a or a press on an action: screen a
  s3 --> s14: the frame posts screen b
  s3 --> s15: the frame posts screen c or a press on an action: screen c
  s3 --> s16: the frame posts screen x
  s3 --> s17: Comment
  s4 --> s0: Escape: the walk ends or Leave
  s4 --> s1: Back or Restart
  s4 --> s7: a press on done, which has no link
  s4 --> s18: the frame posts screen a
  s4 --> s19: the frame posts screen b
  s4 --> s20: the frame posts screen c
  s4 --> s21: the frame posts screen x
  s4 --> s22: Comment
  s5 --> s0: Escape: the walk ends or Leave
  s5 --> s1: Back or Restart
  s5 --> s23: the frame posts screen a
  s5 --> s24: the frame posts screen b
  s5 --> s25: the frame posts screen c
  s5 --> s26: the frame posts screen x
  s5 --> s27: Comment
  s6 --> s0: Leave
  s6 --> s1: Comment or Escape: the request mode ends
  s6 --> s28: a press on the screen in the request mode
  s7 --> s0: Escape: the walk ends or Leave
  s7 --> s1: Back or Restart
  s7 --> s18: the frame posts screen a
  s7 --> s19: the frame posts screen b
  s7 --> s20: the frame posts screen c
  s7 --> s21: the frame posts screen x
  s7 --> s32: Comment
  s7 --> s48: Ask for it
  s8 --> s0: Escape: the walk ends or Leave
  s8 --> s1: Restart
  s8 --> s2: Back
  s8 --> s34: Comment
  s9 --> s0: Escape: the walk ends or Leave
  s9 --> s1: Restart
  s9 --> s2: Back
  s9 --> s35: Comment
  s10 --> s0: Escape: the walk ends or Leave
  s10 --> s1: Restart
  s10 --> s2: Back
  s10 --> s29: a press on done, which has no link
  s10 --> s36: Comment
  s11 --> s0: Escape: the walk ends or Leave
  s11 --> s1: Restart
  s11 --> s2: Back
  s11 --> s37: Comment
  s12 --> s0: Leave
  s12 --> s2: Comment or Escape: the request mode ends
  s12 --> s38: a press on the screen in the request mode
  s13 --> s0: Escape: the walk ends or Leave
  s13 --> s1: Restart
  s13 --> s3: Back
  s13 --> s39: Comment
  s14 --> s0: Escape: the walk ends or Leave
  s14 --> s1: Restart
  s14 --> s3: Back
  s14 --> s40: Comment
  s15 --> s0: Escape: the walk ends or Leave
  s15 --> s1: Restart
  s15 --> s3: Back
  s15 --> s30: a press on done, which has no link
  s15 --> s41: Comment
  s16 --> s0: Escape: the walk ends or Leave
  s16 --> s1: Restart
  s16 --> s3: Back
  s16 --> s42: Comment
  s17 --> s0: Leave
  s17 --> s3: Comment or Escape: the request mode ends
  s17 --> s43: a press on the screen in the request mode
  s18 --> s0: Escape: the walk ends or Leave
  s18 --> s1: Restart
  s18 --> s4: Back
  s18 --> s44: Comment
  s19 --> s0: Escape: the walk ends or Leave
  s19 --> s1: Restart
  s19 --> s4: Back
  s19 --> s45: Comment
  s20 --> s0: Escape: the walk ends or Leave
  s20 --> s1: Restart
  s20 --> s4: Back
  s20 --> s31: a press on done, which has no link
  s20 --> s46: Comment
  s21 --> s0: Escape: the walk ends or Leave
  s21 --> s1: Restart
  s21 --> s4: Back
  s21 --> s47: Comment
  s22 --> s0: Leave
  s22 --> s4: Comment or Escape: the request mode ends
  s22 --> s48: a press on the screen in the request mode
  s23 --> s0: Escape: the walk ends or Leave
  s23 --> s1: Restart
  s23 --> s5: Back
  s23 --> s49: Comment
  s24 --> s0: Escape: the walk ends or Leave
  s24 --> s1: Restart
  s24 --> s5: Back
  s24 --> s50: Comment
  s25 --> s0: Escape: the walk ends or Leave
  s25 --> s1: Restart
  s25 --> s5: Back
  s25 --> s33: a press on done, which has no link
  s25 --> s51: Comment
  s26 --> s0: Escape: the walk ends or Leave
  s26 --> s1: Restart
  s26 --> s5: Back
  s26 --> s52: Comment
  s27 --> s0: Leave
  s27 --> s5: Comment or Escape: the request mode ends
  s27 --> s53: a press on the screen in the request mode
  s28 --> s1: Escape: the request closes or Send
  s29 --> s0: Escape: the walk ends or Leave
  s29 --> s1: Restart
  s29 --> s2: Back
  s29 --> s54: Comment
  s29 --> s61: Ask for it
  s30 --> s0: Escape: the walk ends or Leave
  s30 --> s1: Restart
  s30 --> s3: Back
  s30 --> s55: Comment
  s30 --> s65: Ask for it
  s31 --> s0: Escape: the walk ends or Leave
  s31 --> s1: Restart
  s31 --> s4: Back
  s31 --> s56: Comment
  s31 --> s69: Ask for it
  s32 --> s0: Leave
  s32 --> s7: Comment or Escape: the request mode ends
  s32 --> s48: Ask for it
  s32 --> s57: a press on the screen in the request mode
  s33 --> s0: Escape: the walk ends or Leave
  s33 --> s1: Restart
  s33 --> s5: Back
  s33 --> s58: Comment
  s33 --> s73: Ask for it
  s34 --> s0: Leave
  s34 --> s8: Comment or Escape: the request mode ends
  s34 --> s59: a press on the screen in the request mode
  s35 --> s0: Leave
  s35 --> s9: Comment or Escape: the request mode ends
  s35 --> s60: a press on the screen in the request mode
  s36 --> s0: Leave
  s36 --> s10: Comment or Escape: the request mode ends
  s36 --> s61: a press on the screen in the request mode
  s37 --> s0: Leave
  s37 --> s11: Comment or Escape: the request mode ends
  s37 --> s62: a press on the screen in the request mode
  s38 --> s2: Escape: the request closes or Send
  s39 --> s0: Leave
  s39 --> s13: Comment or Escape: the request mode ends
  s39 --> s63: a press on the screen in the request mode
  s40 --> s0: Leave
  s40 --> s14: Comment or Escape: the request mode ends
  s40 --> s64: a press on the screen in the request mode
  s41 --> s0: Leave
  s41 --> s15: Comment or Escape: the request mode ends
  s41 --> s65: a press on the screen in the request mode
  s42 --> s0: Leave
  s42 --> s16: Comment or Escape: the request mode ends
  s42 --> s66: a press on the screen in the request mode
  s43 --> s3: Escape: the request closes or Send
  s44 --> s0: Leave
  s44 --> s18: Comment or Escape: the request mode ends
  s44 --> s67: a press on the screen in the request mode
  s45 --> s0: Leave
  s45 --> s19: Comment or Escape: the request mode ends
  s45 --> s68: a press on the screen in the request mode
  s46 --> s0: Leave
  s46 --> s20: Comment or Escape: the request mode ends
  s46 --> s69: a press on the screen in the request mode
  s47 --> s0: Leave
  s47 --> s21: Comment or Escape: the request mode ends
  s47 --> s70: a press on the screen in the request mode
  s48 --> s4: Escape: the request closes or Send
  s49 --> s0: Leave
  s49 --> s23: Comment or Escape: the request mode ends
  s49 --> s71: a press on the screen in the request mode
  s50 --> s0: Leave
  s50 --> s24: Comment or Escape: the request mode ends
  s50 --> s72: a press on the screen in the request mode
  s51 --> s0: Leave
  s51 --> s25: Comment or Escape: the request mode ends
  s51 --> s73: a press on the screen in the request mode
  s52 --> s0: Leave
  s52 --> s26: Comment or Escape: the request mode ends
  s52 --> s74: a press on the screen in the request mode
  s53 --> s5: Escape: the request closes or Send
  s54 --> s0: Leave
  s54 --> s29: Comment or Escape: the request mode ends
  s54 --> s61: Ask for it
  s54 --> s75: a press on the screen in the request mode
  s55 --> s0: Leave
  s55 --> s30: Comment or Escape: the request mode ends
  s55 --> s65: Ask for it
  s55 --> s76: a press on the screen in the request mode
  s56 --> s0: Leave
  s56 --> s31: Comment or Escape: the request mode ends
  s56 --> s69: Ask for it
  s56 --> s77: a press on the screen in the request mode
  s57 --> s7: Escape: the request closes or Send
  s58 --> s0: Leave
  s58 --> s33: Comment or Escape: the request mode ends
  s58 --> s73: Ask for it
  s58 --> s78: a press on the screen in the request mode
  s59 --> s8: Escape: the request closes or Send
  s60 --> s9: Escape: the request closes or Send
  s61 --> s10: Escape: the request closes or Send
  s62 --> s11: Escape: the request closes or Send
  s63 --> s13: Escape: the request closes or Send
  s64 --> s14: Escape: the request closes or Send
  s65 --> s15: Escape: the request closes or Send
  s66 --> s16: Escape: the request closes or Send
  s67 --> s18: Escape: the request closes or Send
  s68 --> s19: Escape: the request closes or Send
  s69 --> s20: Escape: the request closes or Send
  s70 --> s21: Escape: the request closes or Send
  s71 --> s23: Escape: the request closes or Send
  s72 --> s24: Escape: the request closes or Send
  s73 --> s25: Escape: the request closes or Send
  s74 --> s26: Escape: the request closes or Send
  s75 --> s29: Escape: the request closes or Send
  s76 --> s30: Escape: the request closes or Send
  s77 --> s31: Escape: the request closes or Send
  s78 --> s33: Escape: the request closes or Send
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  class s0 tan
  class s0 bugPath
  class s1 teal
  class s1 bugPath
  class s2 teal
  class s2 breaks
  class s2 bugPath
  class s3 teal
  class s4 teal
  class s4 breaks
  class s5 teal
  class s5 breaks
  class s6 teal
  class s7 teal
  class s7 breaks
  class s8 teal
  class s8 breaks
  class s9 teal
  class s9 breaks
  class s10 teal
  class s10 breaks
  class s11 teal
  class s11 breaks
  class s12 teal
  class s12 breaks
  class s13 teal
  class s14 teal
  class s14 breaks
  class s15 teal
  class s16 teal
  class s16 breaks
  class s17 teal
  class s18 teal
  class s18 breaks
  class s19 teal
  class s19 breaks
  class s20 teal
  class s20 breaks
  class s21 teal
  class s21 breaks
  class s22 teal
  class s22 breaks
  class s23 teal
  class s23 breaks
  class s24 teal
  class s24 breaks
  class s25 teal
  class s25 breaks
  class s26 teal
  class s26 breaks
  class s27 teal
  class s27 breaks
  class s28 blue
  class s29 teal
  class s29 breaks
  class s30 teal
  class s31 teal
  class s31 breaks
  class s32 teal
  class s32 breaks
  class s33 teal
  class s33 breaks
  class s34 teal
  class s34 breaks
  class s35 teal
  class s35 breaks
  class s36 teal
  class s36 breaks
  class s37 teal
  class s37 breaks
  class s38 blue
  class s38 breaks
  class s39 teal
  class s40 teal
  class s40 breaks
  class s41 teal
  class s42 teal
  class s42 breaks
  class s43 blue
  class s44 teal
  class s44 breaks
  class s45 teal
  class s45 breaks
  class s46 teal
  class s46 breaks
  class s47 teal
  class s47 breaks
  class s48 blue
  class s48 breaks
  class s49 teal
  class s49 breaks
  class s50 teal
  class s50 breaks
  class s51 teal
  class s51 breaks
  class s52 teal
  class s52 breaks
  class s53 blue
  class s53 breaks
  class s54 teal
  class s54 breaks
  class s55 teal
  class s56 teal
  class s56 breaks
  class s57 blue
  class s57 breaks
  class s58 teal
  class s58 breaks
  class s59 blue
  class s59 breaks
  class s60 blue
  class s60 breaks
  class s61 blue
  class s61 breaks
  class s62 blue
  class s62 breaks
  class s63 blue
  class s64 blue
  class s64 breaks
  class s65 blue
  class s66 blue
  class s66 breaks
  class s67 blue
  class s67 breaks
  class s68 blue
  class s68 breaks
  class s69 blue
  class s69 breaks
  class s70 blue
  class s70 breaks
  class s71 blue
  class s71 breaks
  class s72 blue
  class s72 breaks
  class s73 blue
  class s73 breaks
  class s74 blue
  class s74 breaks
  class s75 blue
  class s75 breaks
  class s76 blue
  class s77 blue
  class s77 breaks
  class s78 blue
  class s78 breaks
```

## What the model leaves out

The same as [viewer-walk](viewer-walk.md). A frame that posts an address is the same bug: the
sandbox of the iframe has no `allow-top-navigation`, and the viewer reads no address from a frame.
