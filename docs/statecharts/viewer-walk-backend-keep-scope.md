# viewer: why a pick of the backend starts a new scope

This chart breaks on purpose. It is [viewer-walk-backend](viewer-walk-backend.md) with a pick of
the switch that changes only the value of the switch
([WalkBackendKeepScope.cfg](models/viewer/WalkBackendKeepScope.cfg), `KeepScope = TRUE`). The
scope of the screen keeps the backend that it started with. So after a pick of `live`, the next
press makes a call that waits for an example answer, while the bar says `live`. The person then
reads an answer of the examples as an answer of the product. So a pick closes the scope and
starts the walk again in a new scope with the new backend
([SPEC-prototype](../../SPEC-prototype.md) decision 34). TLC finds `EachCallWaitsOnTheSwitch`
broken in 3 steps.

```mermaid
---
title: "viewer: the backend of the walk, example answers or a live server"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: canvas
    lg1: walk
    lg2: call
    lg3: held
    lg4: Breaks EachCallWaitsOnTheSwitch or HeldOnlyForTheServer
    lg5: Path to the APickStartsAgain or EachCallWaitsOnTheSwitch or HeldOnlyForTheServer bug
  }
  class lg0 tan
  class lg1 teal
  class lg2 blue
  class lg3 yellow
  class lg4 breaks
  class lg5 bugPath
  s0: Switch: example answers, live server not set up, The canvas
  s1: Switch: example answers, live server not set up, Walk: the first state
  s2: Switch: example answers, live server starting, The canvas
  s3: Switch: live server, live server not set up, The canvas
  s4: Switch: example answers, live server not set up, Walk: the first state, a call waits for the pick of its answer
  s5: Switch: example answers, live server starting, Walk: the first state
  s6: Switch: example answers, live server failed, The canvas
  s7: Switch: example answers, live server ready, The canvas
  s8: Switch: live server, live server not set up, Walk: the first state (its scope: example answers)
  s9: Switch: live server, live server not set up, Walk held: the bar says why, no screen runs
  s10: Switch: live server, live server starting, The canvas
  s11: Switch: example answers, live server failed, Walk: the first state
  s12: Switch: example answers, live server ready, Walk: the first state
  s13: Switch: example answers, live server starting, Walk: the first state, a call waits for the pick of its answer
  s14: Switch: example answers, live server not set up, Walk: a later state
  s15: Switch: example answers, live server gone, The canvas
  s16: Switch: live server, live server not set up, Walk: the first state (its scope: example answers), a call waits for the pick of its answer
  s17: Switch: live server, live server starting, Walk: the first state (its scope: example answers)
  s18: Switch: live server, live server starting, Walk held: the bar says why, no screen runs
  s19: Switch: live server, live server failed, The canvas
  s20: Switch: live server, live server ready, The canvas
  s21: Switch: example answers, live server failed, Walk: the first state, a call waits for the pick of its answer
  s22: Switch: example answers, live server gone, Walk: the first state
  s23: Switch: example answers, live server ready, Walk: the first state, a call waits for the pick of its answer
  s24: Switch: example answers, live server not set up, Walk: a later state, a call waits for the pick of its answer
  s25: Switch: example answers, live server starting, Walk: a later state
  s26: Switch: live server, live server failed, Walk: the first state (its scope: example answers)
  s27: Switch: live server, live server ready, Walk: the first state (its scope: example answers)
  s28: Switch: live server, live server ready, Walk: the first state
  s29: Switch: live server, live server starting, Walk: the first state (its scope: example answers), a call waits for the pick of its answer
  s30: Switch: live server, live server failed, Walk held: the bar says why, no screen runs
  s31: Switch: live server, live server not set up, Walk: a later state (its scope: example answers)
  s32: Switch: live server, live server gone, The canvas
  s33: Switch: example answers, live server gone, Walk: the first state, a call waits for the pick of its answer
  s34: Switch: example answers, live server ready, Walk: the first state (its scope: live server)
  s35: Switch: example answers, live server failed, Walk: a later state
  s36: Switch: example answers, live server ready, Walk: a later state
  s37: Switch: example answers, live server starting, Walk: a later state, a call waits for the pick of its answer
  s38: Switch: live server, live server failed, Walk: the first state (its scope: example answers), a call waits for the pick of its answer
  s39: Switch: live server, live server gone, Walk: the first state (its scope: example answers)
  s40: Switch: live server, live server ready, Walk: the first state (its scope: example answers), a call waits for the pick of its answer
  s41: Switch: live server, live server ready, Walk: the first state, a call waits on the live server
  s42: Switch: live server, live server gone, Walk held: the bar says why, no screen runs
  s43: Switch: live server, live server not set up, Walk: a later state (its scope: example answers), a call waits for the pick of its answer
  s44: Switch: live server, live server starting, Walk: a later state (its scope: example answers)
  s45: Switch: example answers, live server ready, Walk: the first state (its scope: live server), a call waits on the live server
  s46: Switch: example answers, live server gone, Walk held: the bar says why, no screen runs
  s47: Switch: example answers, live server failed, Walk: a later state, a call waits for the pick of its answer
  s48: Switch: example answers, live server gone, Walk: a later state
  s49: Switch: example answers, live server ready, Walk: a later state, a call waits for the pick of its answer
  s50: Switch: live server, live server gone, Walk: the first state (its scope: example answers), a call waits for the pick of its answer
  s51: Switch: live server, live server failed, Walk: a later state (its scope: example answers)
  s52: Switch: live server, live server ready, Walk: a later state (its scope: example answers)
  s53: Switch: live server, live server ready, Walk: a later state
  s54: Switch: live server, live server starting, Walk: a later state (its scope: example answers), a call waits for the pick of its answer
  s55: Switch: example answers, live server starting, Walk held: the bar says why, no screen runs
  s56: Switch: example answers, live server gone, Walk: a later state, a call waits for the pick of its answer
  s57: Switch: example answers, live server ready, Walk: a later state (its scope: live server)
  s58: Switch: live server, live server failed, Walk: a later state (its scope: example answers), a call waits for the pick of its answer
  s59: Switch: live server, live server gone, Walk: a later state (its scope: example answers)
  s60: Switch: live server, live server ready, Walk: a later state (its scope: example answers), a call waits for the pick of its answer
  s61: Switch: live server, live server ready, Walk: a later state, a call waits on the live server
  s62: Switch: example answers, live server failed, Walk held: the bar says why, no screen runs
  s63: Switch: example answers, live server ready, Walk held: the bar says why, no screen runs
  s64: Switch: example answers, live server ready, Walk: a later state (its scope: live server), a call waits on the live server
  s65: Switch: live server, live server gone, Walk: a later state (its scope: example answers), a call waits for the pick of its answer
  [*] --> s0
  s0 --> s1: a press on Walk
  s0 --> s2: the hub sets up the live server
  s0 --> s3: the person picks live server
  s1 --> s0: Leave
  s1 --> s4: a press on the screen makes a call
  s1 --> s5: the hub sets up the live server
  s1 --> s8: the person picks live server
  s2 --> s5: a press on Walk
  s2 --> s6: the live server fails to start
  s2 --> s7: the live server is ready
  s2 --> s10: the person picks live server
  s3 --> s0: the person picks example answers
  s3 --> s9: a press on Walk
  s3 --> s10: the hub sets up the live server
  s4 --> s0: Leave
  s4 --> s13: the hub sets up the live server
  s4 --> s14: the person picks the answer
  s4 --> s16: the person picks live server
  s5 --> s2: Leave
  s5 --> s11: the live server fails to start
  s5 --> s12: the live server is ready
  s5 --> s13: a press on the screen makes a call
  s5 --> s17: the person picks live server
  s6 --> s2: a new deploy
  s6 --> s11: a press on Walk
  s6 --> s19: the person picks live server
  s7 --> s12: a press on Walk
  s7 --> s15: the live server goes
  s7 --> s20: the person picks live server
  s8 --> s1: the person picks example answers
  s8 --> s3: Leave
  s8 --> s16: a press on the screen makes a call
  s8 --> s17: the hub sets up the live server
  s9 --> s1: the person picks example answers
  s9 --> s3: Leave
  s9 --> s18: the hub sets up the live server
  s10 --> s2: the person picks example answers
  s10 --> s18: a press on Walk
  s10 --> s19: the live server fails to start
  s10 --> s20: the live server is ready
  s11 --> s5: a new deploy
  s11 --> s6: Leave
  s11 --> s21: a press on the screen makes a call
  s11 --> s26: the person picks live server
  s12 --> s7: Leave
  s12 --> s22: the live server goes
  s12 --> s23: a press on the screen makes a call
  s12 --> s27: the person picks live server
  s13 --> s2: Leave
  s13 --> s21: the live server fails to start
  s13 --> s23: the live server is ready
  s13 --> s25: the person picks the answer
  s13 --> s29: the person picks live server
  s14 --> s0: Leave
  s14 --> s1: Back or Restart
  s14 --> s24: a press on the screen makes a call
  s14 --> s25: the hub sets up the live server
  s14 --> s31: the person picks live server
  s15 --> s2: a new deploy
  s15 --> s22: a press on Walk
  s15 --> s32: the person picks live server
  s16 --> s3: Leave
  s16 --> s4: the person picks example answers
  s16 --> s29: the hub sets up the live server
  s16 --> s31: the person picks the answer
  s17 --> s5: the person picks example answers
  s17 --> s10: Leave
  s17 --> s26: the live server fails to start
  s17 --> s27: the live server is ready
  s17 --> s29: a press on the screen makes a call
  s18 --> s5: the person picks example answers
  s18 --> s10: Leave
  s18 --> s28: the live server is ready
  s18 --> s30: the live server fails to start
  s19 --> s6: the person picks example answers
  s19 --> s10: a new deploy
  s19 --> s30: a press on Walk
  s20 --> s7: the person picks example answers
  s20 --> s28: a press on Walk
  s20 --> s32: the live server goes
  s21 --> s6: Leave
  s21 --> s13: a new deploy
  s21 --> s35: the person picks the answer
  s21 --> s38: the person picks live server
  s22 --> s5: a new deploy
  s22 --> s15: Leave
  s22 --> s33: a press on the screen makes a call
  s22 --> s39: the person picks live server
  s23 --> s7: Leave
  s23 --> s33: the live server goes
  s23 --> s36: the person picks the answer
  s23 --> s40: the person picks live server
  s24 --> s0: Leave
  s24 --> s1: Back or Restart
  s24 --> s14: the person picks the answer
  s24 --> s37: the hub sets up the live server
  s24 --> s43: the person picks live server
  s25 --> s2: Leave
  s25 --> s5: Back or Restart
  s25 --> s35: the live server fails to start
  s25 --> s36: the live server is ready
  s25 --> s37: a press on the screen makes a call
  s25 --> s44: the person picks live server
  s26 --> s11: the person picks example answers
  s26 --> s17: a new deploy
  s26 --> s19: Leave
  s26 --> s38: a press on the screen makes a call
  s27 --> s12: the person picks example answers
  s27 --> s20: Leave
  s27 --> s39: the live server goes
  s27 --> s40: a press on the screen makes a call
  s28 --> s20: Leave
  s28 --> s34: the person picks example answers
  s28 --> s41: a press on the screen makes a call
  s28 --> s42: the live server goes
  s29 --> s10: Leave
  s29 --> s13: the person picks example answers
  s29 --> s38: the live server fails to start
  s29 --> s40: the live server is ready
  s29 --> s44: the person picks the answer
  s30 --> s11: the person picks example answers
  s30 --> s18: a new deploy
  s30 --> s19: Leave
  s31 --> s3: Leave
  s31 --> s8: Back or Restart
  s31 --> s14: the person picks example answers
  s31 --> s43: a press on the screen makes a call
  s31 --> s44: the hub sets up the live server
  s32 --> s10: a new deploy
  s32 --> s15: the person picks example answers
  s32 --> s42: a press on Walk
  s33 --> s13: a new deploy
  s33 --> s15: Leave
  s33 --> s48: the person picks the answer
  s33 --> s50: the person picks live server
  s34 --> s7: Leave
  s34 --> s28: the person picks live server
  s34 --> s45: a press on the screen makes a call
  s34 --> s46: the live server goes
  s35 --> s6: Leave
  s35 --> s11: Back or Restart
  s35 --> s25: a new deploy
  s35 --> s47: a press on the screen makes a call
  s35 --> s51: the person picks live server
  s36 --> s7: Leave
  s36 --> s12: Back or Restart
  s36 --> s48: the live server goes
  s36 --> s49: a press on the screen makes a call
  s36 --> s52: the person picks live server
  s37 --> s2: Leave
  s37 --> s5: Back or Restart
  s37 --> s25: the person picks the answer
  s37 --> s47: the live server fails to start
  s37 --> s49: the live server is ready
  s37 --> s54: the person picks live server
  s38 --> s19: Leave
  s38 --> s21: the person picks example answers
  s38 --> s29: a new deploy
  s38 --> s51: the person picks the answer
  s39 --> s17: a new deploy
  s39 --> s22: the person picks example answers
  s39 --> s32: Leave
  s39 --> s50: a press on the screen makes a call
  s40 --> s20: Leave
  s40 --> s23: the person picks example answers
  s40 --> s50: the live server goes
  s40 --> s52: the person picks the answer
  s41 --> s20: Leave
  s41 --> s42: the live server goes
  s41 --> s45: the person picks example answers
  s41 --> s53: the live server answers
  s42 --> s18: a new deploy
  s42 --> s22: the person picks example answers
  s42 --> s32: Leave
  s43 --> s3: Leave
  s43 --> s8: Back or Restart
  s43 --> s24: the person picks example answers
  s43 --> s31: the person picks the answer
  s43 --> s54: the hub sets up the live server
  s44 --> s10: Leave
  s44 --> s17: Back or Restart
  s44 --> s25: the person picks example answers
  s44 --> s51: the live server fails to start
  s44 --> s52: the live server is ready
  s44 --> s54: a press on the screen makes a call
  s45 --> s7: Leave
  s45 --> s41: the person picks live server
  s45 --> s46: the live server goes
  s45 --> s57: the live server answers
  s46 --> s15: Leave
  s46 --> s42: the person picks live server
  s46 --> s55: a new deploy
  s47 --> s6: Leave
  s47 --> s11: Back or Restart
  s47 --> s35: the person picks the answer
  s47 --> s37: a new deploy
  s47 --> s58: the person picks live server
  s48 --> s15: Leave
  s48 --> s22: Back or Restart
  s48 --> s25: a new deploy
  s48 --> s56: a press on the screen makes a call
  s48 --> s59: the person picks live server
  s49 --> s7: Leave
  s49 --> s12: Back or Restart
  s49 --> s36: the person picks the answer
  s49 --> s56: the live server goes
  s49 --> s60: the person picks live server
  s50 --> s29: a new deploy
  s50 --> s32: Leave
  s50 --> s33: the person picks example answers
  s50 --> s59: the person picks the answer
  s51 --> s19: Leave
  s51 --> s26: Back or Restart
  s51 --> s35: the person picks example answers
  s51 --> s44: a new deploy
  s51 --> s58: a press on the screen makes a call
  s52 --> s20: Leave
  s52 --> s27: Back or Restart
  s52 --> s36: the person picks example answers
  s52 --> s59: the live server goes
  s52 --> s60: a press on the screen makes a call
  s53 --> s20: Leave
  s53 --> s28: Back or Restart
  s53 --> s42: the live server goes
  s53 --> s57: the person picks example answers
  s53 --> s61: a press on the screen makes a call
  s54 --> s10: Leave
  s54 --> s17: Back or Restart
  s54 --> s37: the person picks example answers
  s54 --> s44: the person picks the answer
  s54 --> s58: the live server fails to start
  s54 --> s60: the live server is ready
  s55 --> s2: Leave
  s55 --> s18: the person picks live server
  s55 --> s62: the live server fails to start
  s55 --> s63: the live server is ready
  s56 --> s15: Leave
  s56 --> s22: Back or Restart
  s56 --> s37: a new deploy
  s56 --> s48: the person picks the answer
  s56 --> s65: the person picks live server
  s57 --> s7: Leave
  s57 --> s34: Back or Restart
  s57 --> s46: the live server goes
  s57 --> s53: the person picks live server
  s57 --> s64: a press on the screen makes a call
  s58 --> s19: Leave
  s58 --> s26: Back or Restart
  s58 --> s47: the person picks example answers
  s58 --> s51: the person picks the answer
  s58 --> s54: a new deploy
  s59 --> s32: Leave
  s59 --> s39: Back or Restart
  s59 --> s44: a new deploy
  s59 --> s48: the person picks example answers
  s59 --> s65: a press on the screen makes a call
  s60 --> s20: Leave
  s60 --> s27: Back or Restart
  s60 --> s49: the person picks example answers
  s60 --> s52: the person picks the answer
  s60 --> s65: the live server goes
  s61 --> s20: Leave
  s61 --> s28: Back or Restart
  s61 --> s42: the live server goes
  s61 --> s53: the live server answers
  s61 --> s64: the person picks example answers
  s62 --> s6: Leave
  s62 --> s30: the person picks live server
  s62 --> s55: a new deploy
  s63 --> s7: Leave
  s63 --> s28: the person picks live server
  s63 --> s46: the live server goes
  s64 --> s7: Leave
  s64 --> s34: Back or Restart
  s64 --> s46: the live server goes
  s64 --> s57: the live server answers
  s64 --> s61: the person picks live server
  s65 --> s32: Leave
  s65 --> s39: Back or Restart
  s65 --> s54: a new deploy
  s65 --> s56: the person picks example answers
  s65 --> s59: the person picks the answer
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  class s0 tan
  class s0 bugPath
  class s1 teal
  class s1 bugPath
  class s2 tan
  class s2 bugPath
  class s3 tan
  class s4 blue
  class s4 bugPath
  class s5 teal
  class s6 tan
  class s7 tan
  class s8 teal
  class s8 bugPath
  class s9 yellow
  class s10 tan
  class s10 bugPath
  class s11 teal
  class s12 teal
  class s13 blue
  class s14 teal
  class s14 bugPath
  class s15 tan
  class s16 blue
  class s16 breaks
  class s16 bugPath
  class s17 teal
  class s18 yellow
  class s19 tan
  class s20 tan
  class s20 bugPath
  class s21 blue
  class s22 teal
  class s23 blue
  class s24 blue
  class s25 teal
  class s26 teal
  class s27 teal
  class s28 teal
  class s28 bugPath
  class s29 blue
  class s29 breaks
  class s30 yellow
  class s31 teal
  class s31 bugPath
  class s32 tan
  class s33 blue
  class s34 teal
  class s34 bugPath
  class s35 teal
  class s36 teal
  class s37 blue
  class s38 blue
  class s38 breaks
  class s39 teal
  class s40 blue
  class s40 breaks
  class s41 blue
  class s42 yellow
  class s43 blue
  class s43 breaks
  class s44 teal
  class s45 blue
  class s45 breaks
  class s46 yellow
  class s46 breaks
  class s46 bugPath
  class s47 blue
  class s48 teal
  class s49 blue
  class s50 blue
  class s50 breaks
  class s51 teal
  class s52 teal
  class s53 teal
  class s54 blue
  class s54 breaks
  class s55 yellow
  class s55 breaks
  class s56 blue
  class s57 teal
  class s58 blue
  class s58 breaks
  class s59 teal
  class s60 blue
  class s60 breaks
  class s61 blue
  class s62 yellow
  class s62 breaks
  class s63 yellow
  class s63 breaks
  class s64 blue
  class s64 breaks
  class s65 blue
  class s65 breaks
```

## What the model leaves out

The same as [viewer-walk-backend](viewer-walk-backend.md). A pick that keeps the shown step and
gives its value to a new scope (as Back does) is a different bug: the value of a step on the
examples, such as the code `KDWB-RTQM`, is on no live server, so the next call gets `expired`.
