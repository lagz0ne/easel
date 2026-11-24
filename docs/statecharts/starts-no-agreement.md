# starts, with no agreement: what breaks

This is the chart of [starts](starts.md) with `Agreement = FALSE`: the behavior before
[SPEC-starts](../../SPEC-starts.md). The dispatcher publishes each waiting request, and an agent
claims it, with no agreement of the person. TLC finds the break in 4 steps: a viewer posts a
request, the dispatcher publishes it, the starter starts an agent, and the agent claims it. So a
viewer with a share link starts the work of an agent (E4.5 D11).

The model is [models/starts/Starts.tla](models/starts/Starts.tla) with
[StartsNoAgreement.cfg](models/starts/StartsNoAgreement.cfg).

```mermaid
---
title: "starts: only the person starts the work of an agent, inside the limits"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: waiting
    lg1: held
    lg2: inWork
    lg3: out
    lg4: Breaks AnAgentWorksOnlyOnAnAgreedRequest in some cases
    lg5: Path to the AnAgentWorksOnlyOnAnAgreedRequest or OnlyAnAgreedRequestIsPublished bug
  }
  class lg0 blue
  class lg1 orange
  class lg2 yellow
  class lg3 teal
  class lg4 mayBreak
  class lg5 bugPath
  s0: Not posted
  s1: Waits, of a viewer, not agreed, shows: waits for the person to agree
  s2: Waits, of the person, agreed
  s3: Waits, of a viewer, not agreed, refused, shows: the channel refused it
  s4: Waits, of a viewer, not agreed, published, shows: waits for the person to agree
  s5: Waits, of the person, agreed, refused, shows: the channel refused it
  s6: Waits, of the person, agreed, published
  s7: Waits, of a viewer, agreed
  s8: Waits, of a viewer, not agreed, published, shows: the start failed
  s9: Waits, of a viewer, not agreed, an old message waits, shows: waits for the person to agree
  s10: Waits, of a viewer, not agreed, published, an agent starts
  s11: Waits, of the person, agreed, published, shows: the start failed
  s12: Waits, of the person, agreed, an old message waits
  s13: Waits, of the person, agreed, published, an agent starts
  s14: Waits, of a viewer, agreed, refused
  s15: Waits, of a viewer, agreed, refused, shows: the channel refused it
  s16: Waits, of a viewer, agreed, published
  s17: In work by its agent
  s18: Waits, of a viewer, not agreed, refused, an old message waits, shows: the channel refused it
  s19: Waits, of a viewer, not agreed, published, an old message waits, shows: waits for the person to agree
  s20: Waits, of a viewer, not agreed, an agent starts, shows: waits for the person to agree
  s21: Waits, of the person, agreed, refused, an old message waits, shows: the channel refused it
  s22: Waits, of the person, agreed, published, an old message waits
  s23: Waits, of the person, agreed, an agent starts
  s24: Waits, of the person, agreed, published, shows: waits for the limit
  s25: Waits, of a viewer, agreed, published, shows: the start failed
  s26: Waits, of a viewer, agreed, an old message waits
  s27: Waits, of a viewer, agreed, published, an agent starts
  s28: Out of the queue
  s29: Waits, of a viewer, not agreed
  s30: Waits, of a viewer, not agreed, published, an old message waits, shows: the start failed
  s31: Waits, of a viewer, not agreed, refused, an agent starts, shows: the channel refused it
  s32: Waits, of a viewer, not agreed, published, an agent starts, shows: waits for the person to agree
  s33: Waits, of a viewer, not agreed, published, an old message waits, an agent starts
  s34: Waits, of the person, agreed, published, an old message waits, shows: the start failed
  s35: Waits, of the person, agreed, refused, an agent starts, shows: the channel refused it
  s36: Waits, of the person, agreed, published, an old message waits, an agent starts
  s37: Waits, of a viewer, agreed, refused, an old message waits
  s38: Waits, of a viewer, agreed, refused, an old message waits, shows: the channel refused it
  s39: Waits, of a viewer, agreed, published, an old message waits
  s40: Waits, of a viewer, agreed, an agent starts
  s41: Waits, of a viewer, agreed, published, shows: waits for the limit
  s42: Waits, of a viewer, not agreed, published
  s43: Waits, of a viewer, not agreed, published, an agent starts, shows: the start failed
  s44: Waits, of a viewer, not agreed, an old message waits, an agent starts, shows: waits for the person to agree
  s45: Waits, of the person, agreed, published, an agent starts, shows: the start failed
  s46: Waits, of the person, agreed, an old message waits, an agent starts
  s47: Waits, of the person, agreed, published, an old message waits, shows: waits for the limit
  s48: Waits, of a viewer, agreed, published, an old message waits, shows: the start failed
  s49: Waits, of a viewer, agreed, refused, an agent starts
  s50: Waits, of a viewer, agreed, refused, an agent starts, shows: the channel refused it
  s51: Waits, of a viewer, agreed, published, an old message waits, an agent starts
  s52: Waits, of a viewer, not agreed, an old message waits
  s53: Waits, of a viewer, not agreed, refused, an old message waits, an agent starts, shows: the channel refused it
  s54: Waits, of a viewer, not agreed, published, an old message waits, an agent starts, shows: waits for the person to agree
  s55: Waits, of a viewer, not agreed, published, shows: waits for the limit
  s56: Waits, of the person, agreed, refused, an old message waits, an agent starts, shows: the channel refused it
  s57: Waits, of a viewer, agreed, published, an agent starts, shows: the start failed
  s58: Waits, of a viewer, agreed, an old message waits, an agent starts
  s59: Waits, of a viewer, agreed, published, an old message waits, shows: waits for the limit
  s60: Out of the queue, an agent starts
  s61: Waits, of a viewer, not agreed, published, an old message waits
  s62: Waits, of a viewer, not agreed, an agent starts
  s63: Waits, of a viewer, agreed, refused, an old message waits, an agent starts
  s64: Waits, of a viewer, agreed, refused, an old message waits, an agent starts, shows: the channel refused it
  s65: Waits, of a viewer, not agreed, published, an old message waits, shows: waits for the limit
  [*] --> s0
  s0 --> s1: a viewer posts it
  s0 --> s2: a viewer posts it
  s1 --> s2: a viewer edits, answers, adds a note or reopens it
  s1 --> s3: NATS refuses it 3 times
  s1 --> s4: the dispatcher publishes it
  s1 --> s7: the person agrees
  s2 --> s1: a viewer edits, answers, adds a note or reopens it
  s2 --> s5: NATS refuses it 3 times
  s2 --> s6: the dispatcher publishes it
  s3 --> s1: a viewer edits, answers, adds a note or reopens it
  s3 --> s2: a viewer edits, answers, adds a note or reopens it
  s3 --> s14: the person agrees
  s4 --> s8: the start fails#59; the starter reports it
  s4 --> s9: a viewer edits, answers, adds a note or reopens it
  s4 --> s10: the starter starts an agent
  s4 --> s12: a viewer edits, answers, adds a note or reopens it
  s4 --> s16: the person agrees
  s5 --> s1: a viewer edits, answers, adds a note or reopens it
  s5 --> s2: a viewer edits, answers, adds a note or reopens it
  s6 --> s9: a viewer edits, answers, adds a note or reopens it
  s6 --> s11: the start fails#59; the starter reports it
  s6 --> s12: a viewer edits, answers, adds a note or reopens it
  s6 --> s13: the starter starts an agent
  s7 --> s1: a viewer edits, answers, adds a note or reopens it
  s7 --> s2: a viewer edits, answers, adds a note or reopens it
  s7 --> s15: NATS refuses it 3 times
  s7 --> s16: the dispatcher publishes it
  s8 --> s9: a viewer edits, answers, adds a note or reopens it
  s8 --> s10: the starter starts an agent
  s8 --> s12: a viewer edits, answers, adds a note or reopens it
  s8 --> s16: the person agrees
  s9 --> s12: a viewer edits, answers, adds a note or reopens it
  s9 --> s18: NATS refuses it 3 times
  s9 --> s19: the dispatcher publishes it
  s9 --> s20: the starter starts an agent from an old message
  s9 --> s26: the person agrees
  s10 --> s17: the agent claims it
  s10 --> s20: a viewer edits, answers, adds a note or reopens it
  s10 --> s23: a viewer edits, answers, adds a note or reopens it
  s10 --> s27: the person agrees
  s11 --> s9: a viewer edits, answers, adds a note or reopens it
  s11 --> s12: a viewer edits, answers, adds a note or reopens it
  s11 --> s13: the starter starts an agent
  s12 --> s9: a viewer edits, answers, adds a note or reopens it
  s12 --> s21: NATS refuses it 3 times
  s12 --> s22: the dispatcher publishes it
  s12 --> s23: the starter starts an agent from an old message
  s13 --> s20: a viewer edits, answers, adds a note or reopens it
  s13 --> s17: the agent claims it
  s13 --> s23: a viewer edits, answers, adds a note or reopens it
  s6 --> s24: easel shows the report of the starter
  s14 --> s1: a viewer edits, answers, adds a note or reopens it
  s14 --> s2: a viewer edits, answers, adds a note or reopens it
  s15 --> s1: a viewer edits, answers, adds a note or reopens it
  s15 --> s2: a viewer edits, answers, adds a note or reopens it
  s16 --> s9: a viewer edits, answers, adds a note or reopens it
  s16 --> s12: a viewer edits, answers, adds a note or reopens it
  s16 --> s25: the start fails#59; the starter reports it
  s16 --> s27: the starter starts an agent
  s17 --> s28: the agent resolves, asks or declines
  s17 --> s29: a release, or the lease runs out
  s18 --> s9: a viewer edits, answers, adds a note or reopens it
  s18 --> s12: a viewer edits, answers, adds a note or reopens it
  s18 --> s31: the starter starts an agent from an old message
  s18 --> s37: the person agrees
  s19 --> s9: a viewer edits, answers, adds a note or reopens it
  s19 --> s12: a viewer edits, answers, adds a note or reopens it
  s19 --> s30: the start fails#59; the starter reports it
  s19 --> s32: the starter starts an agent from an old message
  s19 --> s33: the starter starts an agent
  s19 --> s39: the person agrees
  s20 --> s23: a viewer edits, answers, adds a note or reopens it
  s20 --> s17: the agent claims it
  s20 --> s31: NATS refuses it 3 times
  s20 --> s32: the dispatcher publishes it
  s20 --> s40: the person agrees
  s17 --> s2: a release, or the lease runs out
  s21 --> s9: a viewer edits, answers, adds a note or reopens it
  s21 --> s12: a viewer edits, answers, adds a note or reopens it
  s21 --> s35: the starter starts an agent from an old message
  s22 --> s9: a viewer edits, answers, adds a note or reopens it
  s22 --> s12: a viewer edits, answers, adds a note or reopens it
  s22 --> s13: the starter starts an agent from an old message
  s22 --> s34: the start fails#59; the starter reports it
  s22 --> s36: the starter starts an agent
  s23 --> s13: the dispatcher publishes it
  s23 --> s20: a viewer edits, answers, adds a note or reopens it
  s23 --> s17: the agent claims it
  s23 --> s35: NATS refuses it 3 times
  s24 --> s9: a viewer edits, answers, adds a note or reopens it
  s24 --> s12: a viewer edits, answers, adds a note or reopens it
  s25 --> s9: a viewer edits, answers, adds a note or reopens it
  s25 --> s12: a viewer edits, answers, adds a note or reopens it
  s25 --> s27: the starter starts an agent
  s26 --> s9: a viewer edits, answers, adds a note or reopens it
  s26 --> s12: a viewer edits, answers, adds a note or reopens it
  s26 --> s38: NATS refuses it 3 times
  s26 --> s39: the dispatcher publishes it
  s26 --> s40: the starter starts an agent from an old message
  s27 --> s20: a viewer edits, answers, adds a note or reopens it
  s27 --> s23: a viewer edits, answers, adds a note or reopens it
  s27 --> s17: the agent claims it
  s16 --> s41: easel shows the report of the starter
  s29 --> s2: a viewer edits, answers, adds a note or reopens it
  s29 --> s1: a viewer edits, answers, adds a note or reopens it
  s29 --> s3: NATS refuses it 3 times
  s29 --> s42: the dispatcher publishes it
  s29 --> s7: the person agrees
  s30 --> s9: a viewer edits, answers, adds a note or reopens it
  s30 --> s12: a viewer edits, answers, adds a note or reopens it
  s30 --> s33: the starter starts an agent
  s30 --> s43: the starter starts an agent from an old message
  s30 --> s39: the person agrees
  s31 --> s20: a viewer edits, answers, adds a note or reopens it
  s31 --> s23: a viewer edits, answers, adds a note or reopens it
  s31 --> s17: the agent claims it
  s31 --> s49: the person agrees
  s32 --> s20: a viewer edits, answers, adds a note or reopens it
  s32 --> s23: a viewer edits, answers, adds a note or reopens it
  s32 --> s27: the person agrees
  s32 --> s17: the agent claims it
  s33 --> s17: the agent claims it
  s33 --> s44: a viewer edits, answers, adds a note or reopens it
  s33 --> s46: a viewer edits, answers, adds a note or reopens it
  s33 --> s51: the person agrees
  s24 --> s6: easel shows the report of the starter
  s24 --> s11: the start fails#59; the starter reports it
  s24 --> s13: the starter starts an agent
  s34 --> s9: a viewer edits, answers, adds a note or reopens it
  s34 --> s12: a viewer edits, answers, adds a note or reopens it
  s34 --> s36: the starter starts an agent
  s34 --> s45: the starter starts an agent from an old message
  s35 --> s20: a viewer edits, answers, adds a note or reopens it
  s35 --> s23: a viewer edits, answers, adds a note or reopens it
  s35 --> s17: the agent claims it
  s36 --> s44: a viewer edits, answers, adds a note or reopens it
  s36 --> s17: the agent claims it
  s36 --> s46: a viewer edits, answers, adds a note or reopens it
  s22 --> s47: easel shows the report of the starter
  s17 --> s7: a release, or the lease runs out
  s37 --> s9: a viewer edits, answers, adds a note or reopens it
  s37 --> s12: a viewer edits, answers, adds a note or reopens it
  s37 --> s49: the starter starts an agent from an old message
  s38 --> s9: a viewer edits, answers, adds a note or reopens it
  s38 --> s12: a viewer edits, answers, adds a note or reopens it
  s38 --> s50: the starter starts an agent from an old message
  s39 --> s9: a viewer edits, answers, adds a note or reopens it
  s39 --> s12: a viewer edits, answers, adds a note or reopens it
  s39 --> s27: the starter starts an agent from an old message
  s39 --> s48: the start fails#59; the starter reports it
  s39 --> s51: the starter starts an agent
  s40 --> s20: a viewer edits, answers, adds a note or reopens it
  s40 --> s23: a viewer edits, answers, adds a note or reopens it
  s40 --> s27: the dispatcher publishes it
  s40 --> s17: the agent claims it
  s40 --> s50: NATS refuses it 3 times
  s41 --> s9: a viewer edits, answers, adds a note or reopens it
  s41 --> s12: a viewer edits, answers, adds a note or reopens it
  s17 --> s52: a release, or the lease runs out
  s42 --> s10: the starter starts an agent
  s42 --> s8: the start fails#59; the starter reports it
  s42 --> s9: a viewer edits, answers, adds a note or reopens it
  s42 --> s12: a viewer edits, answers, adds a note or reopens it
  s42 --> s16: the person agrees
  s43 --> s20: a viewer edits, answers, adds a note or reopens it
  s43 --> s23: a viewer edits, answers, adds a note or reopens it
  s43 --> s17: the agent claims it
  s43 --> s27: the person agrees
  s44 --> s46: a viewer edits, answers, adds a note or reopens it
  s44 --> s17: the agent claims it
  s44 --> s53: NATS refuses it 3 times
  s44 --> s54: the dispatcher publishes it
  s44 --> s58: the person agrees
  s42 --> s55: easel shows the report of the starter
  s17 --> s12: a release, or the lease runs out
  s45 --> s20: a viewer edits, answers, adds a note or reopens it
  s45 --> s23: a viewer edits, answers, adds a note or reopens it
  s45 --> s17: the agent claims it
  s46 --> s36: the dispatcher publishes it
  s46 --> s44: a viewer edits, answers, adds a note or reopens it
  s46 --> s17: the agent claims it
  s46 --> s56: NATS refuses it 3 times
  s47 --> s9: a viewer edits, answers, adds a note or reopens it
  s47 --> s12: a viewer edits, answers, adds a note or reopens it
  s41 --> s16: easel shows the report of the starter
  s41 --> s25: the start fails#59; the starter reports it
  s41 --> s27: the starter starts an agent
  s48 --> s9: a viewer edits, answers, adds a note or reopens it
  s48 --> s12: a viewer edits, answers, adds a note or reopens it
  s48 --> s51: the starter starts an agent
  s48 --> s57: the starter starts an agent from an old message
  s49 --> s20: a viewer edits, answers, adds a note or reopens it
  s49 --> s23: a viewer edits, answers, adds a note or reopens it
  s49 --> s17: the agent claims it
  s50 --> s20: a viewer edits, answers, adds a note or reopens it
  s50 --> s23: a viewer edits, answers, adds a note or reopens it
  s50 --> s17: the agent claims it
  s51 --> s44: a viewer edits, answers, adds a note or reopens it
  s51 --> s46: a viewer edits, answers, adds a note or reopens it
  s51 --> s17: the agent claims it
  s39 --> s59: easel shows the report of the starter
  s28 --> s60: the starter starts an agent from an old message
  s52 --> s9: a viewer edits, answers, adds a note or reopens it
  s52 --> s12: a viewer edits, answers, adds a note or reopens it
  s52 --> s18: NATS refuses it 3 times
  s52 --> s61: the dispatcher publishes it
  s52 --> s62: the starter starts an agent from an old message
  s52 --> s26: the person agrees
  s53 --> s44: a viewer edits, answers, adds a note or reopens it
  s53 --> s46: a viewer edits, answers, adds a note or reopens it
  s53 --> s17: the agent claims it
  s53 --> s63: the person agrees
  s54 --> s44: a viewer edits, answers, adds a note or reopens it
  s54 --> s46: a viewer edits, answers, adds a note or reopens it
  s54 --> s51: the person agrees
  s54 --> s17: the agent claims it
  s55 --> s9: a viewer edits, answers, adds a note or reopens it
  s55 --> s12: a viewer edits, answers, adds a note or reopens it
  s55 --> s16: the person agrees
  s47 --> s13: the starter starts an agent from an old message
  s47 --> s22: easel shows the report of the starter
  s47 --> s34: the start fails#59; the starter reports it
  s47 --> s36: the starter starts an agent
  s56 --> s44: a viewer edits, answers, adds a note or reopens it
  s56 --> s46: a viewer edits, answers, adds a note or reopens it
  s56 --> s17: the agent claims it
  s17 --> s26: a release, or the lease runs out
  s57 --> s20: a viewer edits, answers, adds a note or reopens it
  s57 --> s23: a viewer edits, answers, adds a note or reopens it
  s57 --> s17: the agent claims it
  s58 --> s44: a viewer edits, answers, adds a note or reopens it
  s58 --> s46: a viewer edits, answers, adds a note or reopens it
  s58 --> s51: the dispatcher publishes it
  s58 --> s17: the agent claims it
  s58 --> s64: NATS refuses it 3 times
  s59 --> s9: a viewer edits, answers, adds a note or reopens it
  s59 --> s12: a viewer edits, answers, adds a note or reopens it
  s60 --> s28: the agent is told empty
  s55 --> s10: the starter starts an agent
  s55 --> s42: easel shows the report of the starter
  s55 --> s8: the start fails#59; the starter reports it
  s61 --> s10: the starter starts an agent from an old message
  s61 --> s33: the starter starts an agent
  s61 --> s9: a viewer edits, answers, adds a note or reopens it
  s61 --> s12: a viewer edits, answers, adds a note or reopens it
  s61 --> s30: the start fails#59; the starter reports it
  s61 --> s39: the person agrees
  s62 --> s10: the dispatcher publishes it
  s62 --> s20: a viewer edits, answers, adds a note or reopens it
  s62 --> s23: a viewer edits, answers, adds a note or reopens it
  s62 --> s31: NATS refuses it 3 times
  s62 --> s40: the person agrees
  s62 --> s17: the agent claims it
  s61 --> s65: easel shows the report of the starter
  s59 --> s27: the starter starts an agent from an old message
  s59 --> s39: easel shows the report of the starter
  s59 --> s48: the start fails#59; the starter reports it
  s59 --> s51: the starter starts an agent
  s63 --> s44: a viewer edits, answers, adds a note or reopens it
  s63 --> s46: a viewer edits, answers, adds a note or reopens it
  s63 --> s17: the agent claims it
  s64 --> s44: a viewer edits, answers, adds a note or reopens it
  s64 --> s46: a viewer edits, answers, adds a note or reopens it
  s64 --> s17: the agent claims it
  s65 --> s9: a viewer edits, answers, adds a note or reopens it
  s65 --> s12: a viewer edits, answers, adds a note or reopens it
  s65 --> s39: the person agrees
  s65 --> s10: the starter starts an agent from an old message
  s65 --> s33: the starter starts an agent
  s65 --> s61: easel shows the report of the starter
  s65 --> s30: the start fails#59; the starter reports it
  classDef mayBreak fill:#fff3e6,stroke:#e8730c,stroke-width:2.5px,color:#b85a06
  class s0 blue
  class s0 bugPath
  class s1 orange
  class s1 bugPath
  class s2 blue
  class s3 orange
  class s4 orange
  class s4 bugPath
  class s5 orange
  class s6 blue
  class s7 blue
  class s8 orange
  class s9 orange
  class s10 blue
  class s10 bugPath
  class s11 orange
  class s12 blue
  class s13 blue
  class s14 blue
  class s15 orange
  class s16 blue
  class s17 yellow
  class s17 mayBreak
  class s17 bugPath
  class s18 orange
  class s19 orange
  class s20 orange
  class s21 orange
  class s22 blue
  class s23 blue
  class s24 orange
  class s25 orange
  class s26 blue
  class s27 blue
  class s28 teal
  class s29 blue
  class s30 orange
  class s31 orange
  class s32 orange
  class s33 blue
  class s34 orange
  class s35 orange
  class s36 blue
  class s37 blue
  class s38 orange
  class s39 blue
  class s40 blue
  class s41 orange
  class s42 blue
  class s43 orange
  class s44 orange
  class s45 orange
  class s46 blue
  class s47 orange
  class s48 orange
  class s49 blue
  class s50 orange
  class s51 blue
  class s52 blue
  class s53 orange
  class s54 orange
  class s55 orange
  class s56 orange
  class s57 orange
  class s58 blue
  class s59 orange
  class s60 teal
  class s61 blue
  class s62 blue
  class s63 blue
  class s64 orange
  class s65 orange
```

## Rules

| Rule                                | In plain words                                                              | Result |
| ----------------------------------- | --------------------------------------------------------------------------- | ------ |
| `AnAgentWorksOnlyOnAnAgreedRequest` | An agent works on a request only when the person agreed to it as it is now. | breaks |
| `OnlyAnAgreedRequestIsPublished`    | The dispatcher publishes only a request with an agreement.                  | breaks |
