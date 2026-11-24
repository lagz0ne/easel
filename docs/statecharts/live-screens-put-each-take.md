# live screens: a job that puts each take again (breaks)

This twin of [live-screens](live-screens.md) puts each take, also a take of the build that the
After already has. Then the After moves to the Before on the same build: the Before is no longer
the build before, and two takes of one build put two images. TLC finds the break, and the chart
shows the states up to it. The model is [models/live/LiveScreens.tla](models/live/LiveScreens.tla)
with `PutEachTake = TRUE`.

```mermaid
---
title: "live screens: one take on the page Live, after each deploy"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: none
    lg1: new
    lg2: next
    lg3: same
    lg4: differs
    lg5: failed
    lg6: Breaks BeforeIsTheBuildBeforeAfter
    lg7: Path to the ATakeOfTheSameBuildPutsNothing or BeforeIsTheBuildBeforeAfter bug
  }
  class lg0 tan
  class lg1 teal
  class lg2 blue
  class lg3 teal
  class lg4 orange
  class lg5 pink
  class lg6 breaks
  class lg7 bugPath
  s0: No take yet, live build 1, no After, no Before
  s1: Take failed: the last good stays, live build 1, no After, no Before
  s2: Take new: the first After, live build 1, After of build 1, no Before
  s3: No take yet, live build 2, no After, no Before
  s4: Take failed: the last good stays, live build 1, After of build 1, no Before
  s5: Take differs: nothing put, a finding, live build 1, After of build 1, Before of build 1
  s6: Take same: nothing put, live build 1, After of build 1, Before of build 1
  s7: Take failed: the last good stays, live build 2, no After, no Before
  s8: Take new: the first After, live build 2, After of build 1, no Before
  s9: Take new: the first After, live build 2, After of build 2, no Before
  s10: No take yet, live build 3, no After, no Before
  s11: Take failed: the last good stays, live build 1, After of build 1, Before of build 1
  s12: Take failed: the last good stays, live build 2, After of build 1, no Before
  s13: Take differs: nothing put, a finding, live build 2, After of build 1, Before of build 1
  s14: Take same: nothing put, live build 2, After of build 1, Before of build 1
  s15: Take failed: the last good stays, live build 2, After of build 2, no Before
  s16: Take next: the After moved to the Before, live build 2, After of build 2, Before of build 1
  s17: Take differs: nothing put, a finding, live build 2, After of build 2, Before of build 2
  s18: Take same: nothing put, live build 2, After of build 2, Before of build 2
  s19: Take failed: the last good stays, live build 3, no After, no Before
  s20: Take new: the first After, live build 3, After of build 1, no Before
  s21: Take new: the first After, live build 3, After of build 2, no Before
  s22: Take new: the first After, live build 3, After of build 3, no Before
  s23: Take failed: the last good stays, live build 2, After of build 1, Before of build 1
  s24: Take failed: the last good stays, live build 2, After of build 2, Before of build 1
  s25: Take failed: the last good stays, live build 2, After of build 2, Before of build 2
  s26: Take failed: the last good stays, live build 3, After of build 1, no Before
  s27: Take differs: nothing put, a finding, live build 3, After of build 1, Before of build 1
  s28: Take same: nothing put, live build 3, After of build 1, Before of build 1
  s29: Take failed: the last good stays, live build 3, After of build 2, no Before
  s30: Take next: the After moved to the Before, live build 3, After of build 2, Before of build 1
  s31: Take differs: nothing put, a finding, live build 3, After of build 2, Before of build 2
  s32: Take same: nothing put, live build 3, After of build 2, Before of build 2
  s33: Take failed: the last good stays, live build 3, After of build 3, no Before
  s34: Take next: the After moved to the Before, live build 3, After of build 3, Before of build 1
  s35: Take next: the After moved to the Before, live build 3, After of build 3, Before of build 2
  s36: Take differs: nothing put, a finding, live build 3, After of build 3, Before of build 3
  s37: Take same: nothing put, live build 3, After of build 3, Before of build 3
  s38: Take failed: the last good stays, live build 3, After of build 1, Before of build 1
  s39: Take failed: the last good stays, live build 3, After of build 2, Before of build 1
  s40: Take failed: the last good stays, live build 3, After of build 2, Before of build 2
  s41: Take failed: the last good stays, live build 3, After of build 3, Before of build 1
  s42: Take failed: the last good stays, live build 3, After of build 3, Before of build 2
  s43: Take failed: the last good stays, live build 3, After of build 3, Before of build 3
  [*] --> s0
  s0 --> s1: the take fails: the status names the screen and the reason
  s0 --> s2: the job takes the screen: no After yet, it puts the take as the After
  s0 --> s3: a deploy: the site serves the next build
  s1 --> s2: the job takes the screen: no After yet, it puts the take as the After
  s1 --> s7: a deploy: the site serves the next build
  s2 --> s4: the take fails: the status names the screen and the reason
  s2 --> s5: the job takes the screen again on the same build: other pixels
  s2 --> s6: the job takes the screen again on the same build: the same pixels
  s2 --> s8: a deploy: the site serves the next build
  s3 --> s7: the take fails: the status names the screen and the reason
  s3 --> s9: the job takes the screen: no After yet, it puts the take as the After
  s3 --> s10: a deploy: the site serves the next build
  s4 --> s5: the job takes the screen again on the same build: other pixels
  s4 --> s6: the job takes the screen again on the same build: the same pixels
  s4 --> s12: a deploy: the site serves the next build
  s5 --> s6: the job takes the screen again on the same build: the same pixels
  s5 --> s11: the take fails: the status names the screen and the reason
  s5 --> s13: a deploy: the site serves the next build
  s6 --> s5: the job takes the screen again on the same build: other pixels
  s6 --> s11: the take fails: the status names the screen and the reason
  s6 --> s14: a deploy: the site serves the next build
  s7 --> s9: the job takes the screen: no After yet, it puts the take as the After
  s7 --> s19: a deploy: the site serves the next build
  s8 --> s12: the take fails: the status names the screen and the reason
  s8 --> s16: the job takes the screen of a newer build: the After goes to the Before, the take is the After
  s8 --> s20: a deploy: the site serves the next build
  s9 --> s15: the take fails: the status names the screen and the reason
  s9 --> s17: the job takes the screen again on the same build: other pixels
  s9 --> s18: the job takes the screen again on the same build: the same pixels
  s9 --> s21: a deploy: the site serves the next build
  s10 --> s19: the take fails: the status names the screen and the reason
  s10 --> s22: the job takes the screen: no After yet, it puts the take as the After
  s11 --> s5: the job takes the screen again on the same build: other pixels
  s11 --> s6: the job takes the screen again on the same build: the same pixels
  s11 --> s23: a deploy: the site serves the next build
  s12 --> s16: the job takes the screen of a newer build: the After goes to the Before, the take is the After
  s12 --> s26: a deploy: the site serves the next build
  s13 --> s16: the job takes the screen of a newer build: the After goes to the Before, the take is the After
  s13 --> s23: the take fails: the status names the screen and the reason
  s13 --> s27: a deploy: the site serves the next build
  s14 --> s16: the job takes the screen of a newer build: the After goes to the Before, the take is the After
  s14 --> s23: the take fails: the status names the screen and the reason
  s14 --> s28: a deploy: the site serves the next build
  s15 --> s17: the job takes the screen again on the same build: other pixels
  s15 --> s18: the job takes the screen again on the same build: the same pixels
  s15 --> s29: a deploy: the site serves the next build
  s16 --> s17: the job takes the screen again on the same build: other pixels
  s16 --> s18: the job takes the screen again on the same build: the same pixels
  s16 --> s24: the take fails: the status names the screen and the reason
  s16 --> s30: a deploy: the site serves the next build
  s17 --> s18: the job takes the screen again on the same build: the same pixels
  s17 --> s25: the take fails: the status names the screen and the reason
  s17 --> s31: a deploy: the site serves the next build
  s18 --> s17: the job takes the screen again on the same build: other pixels
  s18 --> s25: the take fails: the status names the screen and the reason
  s18 --> s32: a deploy: the site serves the next build
  s19 --> s22: the job takes the screen: no After yet, it puts the take as the After
  s20 --> s26: the take fails: the status names the screen and the reason
  s20 --> s34: the job takes the screen of a newer build: the After goes to the Before, the take is the After
  s21 --> s29: the take fails: the status names the screen and the reason
  s21 --> s35: the job takes the screen of a newer build: the After goes to the Before, the take is the After
  s22 --> s33: the take fails: the status names the screen and the reason
  s22 --> s36: the job takes the screen again on the same build: other pixels
  s22 --> s37: the job takes the screen again on the same build: the same pixels
  s23 --> s16: the job takes the screen of a newer build: the After goes to the Before, the take is the After
  s23 --> s38: a deploy: the site serves the next build
  s24 --> s17: the job takes the screen again on the same build: other pixels
  s24 --> s18: the job takes the screen again on the same build: the same pixels
  s24 --> s39: a deploy: the site serves the next build
  s25 --> s17: the job takes the screen again on the same build: other pixels
  s25 --> s18: the job takes the screen again on the same build: the same pixels
  s25 --> s40: a deploy: the site serves the next build
  s26 --> s34: the job takes the screen of a newer build: the After goes to the Before, the take is the After
  s27 --> s34: the job takes the screen of a newer build: the After goes to the Before, the take is the After
  s27 --> s38: the take fails: the status names the screen and the reason
  s28 --> s34: the job takes the screen of a newer build: the After goes to the Before, the take is the After
  s28 --> s38: the take fails: the status names the screen and the reason
  s29 --> s35: the job takes the screen of a newer build: the After goes to the Before, the take is the After
  s30 --> s35: the job takes the screen of a newer build: the After goes to the Before, the take is the After
  s30 --> s39: the take fails: the status names the screen and the reason
  s31 --> s35: the job takes the screen of a newer build: the After goes to the Before, the take is the After
  s31 --> s40: the take fails: the status names the screen and the reason
  s32 --> s35: the job takes the screen of a newer build: the After goes to the Before, the take is the After
  s32 --> s40: the take fails: the status names the screen and the reason
  s33 --> s36: the job takes the screen again on the same build: other pixels
  s33 --> s37: the job takes the screen again on the same build: the same pixels
  s34 --> s36: the job takes the screen again on the same build: other pixels
  s34 --> s37: the job takes the screen again on the same build: the same pixels
  s34 --> s41: the take fails: the status names the screen and the reason
  s35 --> s36: the job takes the screen again on the same build: other pixels
  s35 --> s37: the job takes the screen again on the same build: the same pixels
  s35 --> s42: the take fails: the status names the screen and the reason
  s36 --> s37: the job takes the screen again on the same build: the same pixels
  s36 --> s43: the take fails: the status names the screen and the reason
  s37 --> s36: the job takes the screen again on the same build: other pixels
  s37 --> s43: the take fails: the status names the screen and the reason
  s38 --> s34: the job takes the screen of a newer build: the After goes to the Before, the take is the After
  s39 --> s35: the job takes the screen of a newer build: the After goes to the Before, the take is the After
  s40 --> s35: the job takes the screen of a newer build: the After goes to the Before, the take is the After
  s41 --> s36: the job takes the screen again on the same build: other pixels
  s41 --> s37: the job takes the screen again on the same build: the same pixels
  s42 --> s36: the job takes the screen again on the same build: other pixels
  s42 --> s37: the job takes the screen again on the same build: the same pixels
  s43 --> s36: the job takes the screen again on the same build: other pixels
  s43 --> s37: the job takes the screen again on the same build: the same pixels
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  class s0 tan
  class s0 bugPath
  class s1 pink
  class s2 teal
  class s2 bugPath
  class s3 tan
  class s4 pink
  class s5 orange
  class s5 breaks
  class s6 teal
  class s6 breaks
  class s6 bugPath
  class s7 pink
  class s8 teal
  class s9 teal
  class s10 tan
  class s11 pink
  class s11 breaks
  class s12 pink
  class s13 orange
  class s13 breaks
  class s14 teal
  class s14 breaks
  class s15 pink
  class s16 blue
  class s17 orange
  class s17 breaks
  class s18 teal
  class s18 breaks
  class s19 pink
  class s20 teal
  class s21 teal
  class s22 teal
  class s23 pink
  class s23 breaks
  class s24 pink
  class s25 pink
  class s25 breaks
  class s26 pink
  class s27 orange
  class s27 breaks
  class s28 teal
  class s28 breaks
  class s29 pink
  class s30 blue
  class s31 orange
  class s31 breaks
  class s32 teal
  class s32 breaks
  class s33 pink
  class s34 blue
  class s35 blue
  class s36 orange
  class s36 breaks
  class s37 teal
  class s37 breaks
  class s38 pink
  class s38 breaks
  class s39 pink
  class s40 pink
  class s40 breaks
  class s41 pink
  class s42 pink
  class s43 pink
  class s43 breaks
```
