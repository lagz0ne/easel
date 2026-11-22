# kit: a user changes the look, goes back, and a viewer asks

The chart shows the look of one easel, from the seed (kit version 1) until kit version 4. A user changes the look; a look that fails WCAG AA is refused and changes nothing (it draws no arrow). The user goes back one step, which is a new kit version too. A viewer asks for a change at some point, and the request keeps the kit version that the tab showed. The tab has one live document. It can start before the page listens; its piece script says hello at once and again each 50 ms, until the page answers with a port and the current kit. Each later kit goes on that port, so the document shows it with no reload. The model is [models/kit/Kit.tla](models/kit/Kit.tla) with [KitLook.cfg](models/kit/KitLook.cfg) (`Part = "look"`, `KeepKit = TRUE`, `Hello = "each50ms"`). TLC checks every rule below on all 250 of its states, and each one holds. The chart draws 111 of them: the view hides a writer's read.

```mermaid
---
title: "kit: the look and the kit, their kit versions, and what a viewer saw"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: first
    lg1: changed
    lg2: behind
    lg3: asked
    lg4: missed
  }
  class lg0 tan
  class lg1 blue
  class lg2 yellow
  class lg3 teal
  class lg4 orange
  s0: The first look and kit (kit version 1): no tab open yet#59; the page does not listen yet
  s1: The first look and kit (kit version 1): no tab open yet
  s2: The first look and kit (kit version 1): each tab shows it#59; the page does not listen yet
  s3: The first look and kit (kit version 1): each tab shows it#59; a request keeps this kit version#59; the page does not listen yet
  s4: The first look and kit (kit version 1): each tab shows it
  s5: Kit version 2, a new look: no tab open yet#59; the page does not listen yet
  s6: The first look and kit (kit version 1): each tab shows it#59; the page does not listen yet#59; the live document shows it, with no port yet
  s7: The first look and kit (kit version 1): each tab shows it#59; a request keeps this kit version
  s8: Kit version 2, a new look: no tab open yet
  s9: Kit version 2, a new look: a tab shows an older kit version#59; the page does not listen yet
  s10: Kit version 2, a new look: each tab shows it#59; the page does not listen yet
  s11: Kit version 3, the first look again: no tab open yet#59; the page does not listen yet
  s12: The first look and kit (kit version 1): each tab shows it#59; a request keeps this kit version#59; the page does not listen yet#59; the live document shows it, with no port yet
  s13: The first look and kit (kit version 1): each tab shows it#59; the live document shows it, with no port yet
  s14: The first look and kit (kit version 1): each tab shows it#59; the live document has a port and shows it
  s15: Kit version 2, a new look: a tab shows an older kit version#59; a request keeps an older kit version#59; the page does not listen yet
  s16: Kit version 2, a new look: a tab shows an older kit version
  s17: Kit version 2, a new look: each tab shows it#59; a request keeps this kit version#59; the page does not listen yet
  s18: Kit version 2, a new look: each tab shows it
  s19: Kit version 3, the first look again: no tab open yet
  s20: Kit version 3, the first look again: a tab shows an older kit version#59; the page does not listen yet
  s21: Kit version 3, the first look again: each tab shows it#59; the page does not listen yet
  s22: Kit version 4, a new look: no tab open yet#59; the page does not listen yet
  s23: The first look and kit (kit version 1): each tab shows it#59; a request keeps this kit version#59; the live document shows it, with no port yet
  s24: The first look and kit (kit version 1): each tab shows it#59; a request keeps this kit version#59; the live document has a port and shows it
  s25: Kit version 2, a new look: a tab shows an older kit version#59; the page does not listen yet#59; the live document shows an older kit version, with no port yet
  s26: Kit version 2, a new look: each tab shows it#59; the page does not listen yet#59; the live document shows it, with no port yet
  s27: Kit version 2, a new look: a tab shows an older kit version#59; a request keeps an older kit version
  s28: Kit version 2, a new look: each tab shows it#59; a request keeps an older kit version#59; the page does not listen yet
  s29: Kit version 2, a new look: each tab shows it#59; a request keeps this kit version
  s30: Kit version 3, the first look again: a tab shows an older kit version#59; a request keeps an older kit version#59; the page does not listen yet
  s31: Kit version 3, the first look again: a tab shows an older kit version
  s32: Kit version 3, the first look again: each tab shows it#59; a request keeps this kit version#59; the page does not listen yet
  s33: Kit version 3, the first look again: each tab shows it
  s34: Kit version 4, a new look: no tab open yet
  s35: Kit version 4, a new look: a tab shows an older kit version#59; the page does not listen yet
  s36: Kit version 4, a new look: each tab shows it#59; the page does not listen yet
  s37: Kit version 2, a new look: a tab shows an older kit version#59; a request keeps an older kit version#59; the page does not listen yet#59; the live document shows an older kit version, with no port yet
  s38: Kit version 2, a new look: a tab shows an older kit version#59; the live document shows an older kit version, with no port yet
  s39: Kit version 2, a new look: a tab shows an older kit version#59; the live document has a port and shows it
  s40: Kit version 2, a new look: each tab shows it#59; the page does not listen yet#59; the live document shows an older kit version, with no port yet
  s41: Kit version 3, the first look again: a tab shows an older kit version#59; the page does not listen yet#59; the live document shows an older kit version, with no port yet
  s42: Kit version 2, a new look: each tab shows it#59; a request keeps this kit version#59; the page does not listen yet#59; the live document shows it, with no port yet
  s43: Kit version 2, a new look: each tab shows it#59; the live document shows it, with no port yet
  s44: Kit version 2, a new look: each tab shows it#59; the live document has a port and shows it
  s45: Kit version 3, the first look again: each tab shows it#59; the page does not listen yet#59; the live document shows it, with no port yet
  s46: Kit version 2, a new look: each tab shows it#59; a request keeps an older kit version
  s47: Kit version 3, the first look again: a tab shows an older kit version#59; a request keeps an older kit version
  s48: Kit version 3, the first look again: each tab shows it#59; a request keeps an older kit version#59; the page does not listen yet
  s49: Kit version 3, the first look again: each tab shows it#59; a request keeps this kit version
  s50: Kit version 4, a new look: a tab shows an older kit version#59; a request keeps an older kit version#59; the page does not listen yet
  s51: Kit version 4, a new look: a tab shows an older kit version
  s52: Kit version 4, a new look: each tab shows it#59; a request keeps this kit version#59; the page does not listen yet
  s53: Kit version 4, a new look: each tab shows it
  s54: Kit version 2, a new look: a tab shows an older kit version#59; a request keeps an older kit version#59; the live document shows an older kit version, with no port yet
  s55: Kit version 2, a new look: a tab shows an older kit version#59; a request keeps an older kit version#59; the live document has a port and shows it
  s56: Kit version 2, a new look: each tab shows it#59; a request keeps an older kit version#59; the page does not listen yet#59; the live document shows an older kit version, with no port yet
  s57: Kit version 2, a new look: each tab shows it#59; a request keeps this kit version#59; the page does not listen yet#59; the live document shows an older kit version, with no port yet
  s58: Kit version 2, a new look: each tab shows it#59; the live document shows an older kit version, with no port yet
  s59: Kit version 3, the first look again: a tab shows an older kit version#59; a request keeps an older kit version#59; the page does not listen yet#59; the live document shows an older kit version, with no port yet
  s60: Kit version 3, the first look again: a tab shows an older kit version#59; the live document shows an older kit version, with no port yet
  s61: Kit version 3, the first look again: a tab shows an older kit version#59; the live document has a port and shows it
  s62: Kit version 3, the first look again: each tab shows it#59; the page does not listen yet#59; the live document shows an older kit version, with no port yet
  s63: Kit version 4, a new look: a tab shows an older kit version#59; the page does not listen yet#59; the live document shows an older kit version, with no port yet
  s64: Kit version 2, a new look: each tab shows it#59; a request keeps an older kit version#59; the page does not listen yet#59; the live document shows it, with no port yet
  s65: Kit version 2, a new look: each tab shows it#59; a request keeps this kit version#59; the live document shows it, with no port yet
  s66: Kit version 2, a new look: each tab shows it#59; a request keeps this kit version#59; the live document has a port and shows it
  s67: Kit version 3, the first look again: each tab shows it#59; a request keeps this kit version#59; the page does not listen yet#59; the live document shows it, with no port yet
  s68: Kit version 3, the first look again: each tab shows it#59; the live document shows it, with no port yet
  s69: Kit version 3, the first look again: each tab shows it#59; the live document has a port and shows it
  s70: Kit version 4, a new look: each tab shows it#59; the page does not listen yet#59; the live document shows it, with no port yet
  s71: Kit version 3, the first look again: each tab shows it#59; a request keeps an older kit version
  s72: Kit version 4, a new look: a tab shows an older kit version#59; a request keeps an older kit version
  s73: Kit version 4, a new look: each tab shows it#59; a request keeps an older kit version#59; the page does not listen yet
  s74: Kit version 4, a new look: each tab shows it#59; a request keeps this kit version
  s75: Kit version 2, a new look: each tab shows it#59; a request keeps an older kit version#59; the live document shows an older kit version, with no port yet
  s76: Kit version 2, a new look: each tab shows it#59; a request keeps this kit version#59; the live document shows an older kit version, with no port yet
  s77: Kit version 3, the first look again: a tab shows an older kit version#59; a request keeps an older kit version#59; the live document shows an older kit version, with no port yet
  s78: Kit version 3, the first look again: a tab shows an older kit version#59; a request keeps an older kit version#59; the live document has a port and shows it
  s79: Kit version 3, the first look again: each tab shows it#59; a request keeps an older kit version#59; the page does not listen yet#59; the live document shows an older kit version, with no port yet
  s80: Kit version 3, the first look again: each tab shows it#59; a request keeps this kit version#59; the page does not listen yet#59; the live document shows an older kit version, with no port yet
  s81: Kit version 3, the first look again: each tab shows it#59; the live document shows an older kit version, with no port yet
  s82: Kit version 4, a new look: a tab shows an older kit version#59; a request keeps an older kit version#59; the page does not listen yet#59; the live document shows an older kit version, with no port yet
  s83: Kit version 4, a new look: a tab shows an older kit version#59; the live document shows an older kit version, with no port yet
  s84: Kit version 4, a new look: a tab shows an older kit version#59; the live document has a port and shows it
  s85: Kit version 4, a new look: each tab shows it#59; the page does not listen yet#59; the live document shows an older kit version, with no port yet
  s86: Kit version 2, a new look: each tab shows it#59; a request keeps an older kit version#59; the live document shows it, with no port yet
  s87: Kit version 2, a new look: each tab shows it#59; a request keeps an older kit version#59; the live document has a port and shows it
  s88: Kit version 3, the first look again: each tab shows it#59; a request keeps an older kit version#59; the page does not listen yet#59; the live document shows it, with no port yet
  s89: Kit version 3, the first look again: each tab shows it#59; a request keeps this kit version#59; the live document shows it, with no port yet
  s90: Kit version 3, the first look again: each tab shows it#59; a request keeps this kit version#59; the live document has a port and shows it
  s91: Kit version 4, a new look: each tab shows it#59; a request keeps this kit version#59; the page does not listen yet#59; the live document shows it, with no port yet
  s92: Kit version 4, a new look: each tab shows it#59; the live document shows it, with no port yet
  s93: Kit version 4, a new look: each tab shows it#59; the live document has a port and shows it
  s94: Kit version 4, a new look: each tab shows it#59; a request keeps an older kit version
  s95: Kit version 3, the first look again: each tab shows it#59; a request keeps an older kit version#59; the live document shows an older kit version, with no port yet
  s96: Kit version 3, the first look again: each tab shows it#59; a request keeps this kit version#59; the live document shows an older kit version, with no port yet
  s97: Kit version 4, a new look: a tab shows an older kit version#59; a request keeps an older kit version#59; the live document shows an older kit version, with no port yet
  s98: Kit version 4, a new look: a tab shows an older kit version#59; a request keeps an older kit version#59; the live document has a port and shows it
  s99: Kit version 4, a new look: each tab shows it#59; a request keeps an older kit version#59; the page does not listen yet#59; the live document shows an older kit version, with no port yet
  s100: Kit version 4, a new look: each tab shows it#59; a request keeps this kit version#59; the page does not listen yet#59; the live document shows an older kit version, with no port yet
  s101: Kit version 4, a new look: each tab shows it#59; the live document shows an older kit version, with no port yet
  s102: Kit version 3, the first look again: each tab shows it#59; a request keeps an older kit version#59; the live document shows it, with no port yet
  s103: Kit version 3, the first look again: each tab shows it#59; a request keeps an older kit version#59; the live document has a port and shows it
  s104: Kit version 4, a new look: each tab shows it#59; a request keeps an older kit version#59; the page does not listen yet#59; the live document shows it, with no port yet
  s105: Kit version 4, a new look: each tab shows it#59; a request keeps this kit version#59; the live document shows it, with no port yet
  s106: Kit version 4, a new look: each tab shows it#59; a request keeps this kit version#59; the live document has a port and shows it
  s107: Kit version 4, a new look: each tab shows it#59; a request keeps an older kit version#59; the live document shows an older kit version, with no port yet
  s108: Kit version 4, a new look: each tab shows it#59; a request keeps this kit version#59; the live document shows an older kit version, with no port yet
  s109: Kit version 4, a new look: each tab shows it#59; a request keeps an older kit version#59; the live document shows it, with no port yet
  s110: Kit version 4, a new look: each tab shows it#59; a request keeps an older kit version#59; the live document has a port and shows it
  [*] --> s0
  s0 --> s1: the page listens for hellos
  s0 --> s2: the tab gets the new kit version#59; the page sends it on each port, no reload
  s0 --> s5: a user changes the look (WCAG AA holds)
  s1 --> s4: the tab gets the new kit version#59; the page sends it on each port, no reload
  s2 --> s3: a viewer asks#59; the request keeps this kit version
  s2 --> s4: the page listens for hellos
  s2 --> s6: a live document starts and says hello
  s1 --> s8: a user changes the look (WCAG AA holds)
  s2 --> s9: a user changes the look (WCAG AA holds)
  s3 --> s7: the page listens for hellos
  s3 --> s12: a live document starts and says hello
  s4 --> s7: a viewer asks#59; the request keeps this kit version
  s4 --> s14: a live document starts and says hello
  s5 --> s8: the page listens for hellos
  s5 --> s10: the tab gets the new kit version#59; the page sends it on each port, no reload
  s5 --> s11: a user changes the look (WCAG AA holds) or a user goes back one step
  s6 --> s12: a viewer asks#59; the request keeps this kit version
  s6 --> s13: the page listens for hellos
  s3 --> s15: a user changes the look (WCAG AA holds)
  s4 --> s16: a user changes the look (WCAG AA holds)
  s7 --> s24: a live document starts and says hello
  s8 --> s18: the tab gets the new kit version#59; the page sends it on each port, no reload
  s8 --> s19: a user changes the look (WCAG AA holds) or a user goes back one step
  s9 --> s10: the tab gets the new kit version#59; the page sends it on each port, no reload
  s9 --> s15: a viewer asks#59; the request keeps this kit version
  s9 --> s16: the page listens for hellos
  s9 --> s20: a user changes the look (WCAG AA holds) or a user goes back one step
  s9 --> s25: a live document starts and says hello
  s10 --> s17: a viewer asks#59; the request keeps this kit version
  s10 --> s18: the page listens for hellos
  s10 --> s20: a user changes the look (WCAG AA holds) or a user goes back one step
  s10 --> s26: a live document starts and says hello
  s11 --> s19: the page listens for hellos
  s11 --> s21: the tab gets the new kit version#59; the page sends it on each port, no reload
  s11 --> s22: a user changes the look (WCAG AA holds) or a user goes back one step
  s6 --> s25: a user changes the look (WCAG AA holds)
  s12 --> s23: the page listens for hellos
  s13 --> s14: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s13 --> s23: a viewer asks#59; the request keeps this kit version
  s14 --> s24: a viewer asks#59; the request keeps this kit version
  s7 --> s27: a user changes the look (WCAG AA holds)
  s15 --> s27: the page listens for hellos
  s15 --> s28: the tab gets the new kit version#59; the page sends it on each port, no reload
  s15 --> s30: a user changes the look (WCAG AA holds) or a user goes back one step
  s15 --> s37: a live document starts and says hello
  s16 --> s18: the tab gets the new kit version#59; the page sends it on each port, no reload
  s16 --> s27: a viewer asks#59; the request keeps this kit version
  s16 --> s31: a user changes the look (WCAG AA holds) or a user goes back one step
  s16 --> s39: a live document starts and says hello
  s17 --> s29: the page listens for hellos
  s17 --> s30: a user changes the look (WCAG AA holds) or a user goes back one step
  s17 --> s42: a live document starts and says hello
  s18 --> s29: a viewer asks#59; the request keeps this kit version
  s18 --> s31: a user changes the look (WCAG AA holds) or a user goes back one step
  s18 --> s44: a live document starts and says hello
  s19 --> s33: the tab gets the new kit version#59; the page sends it on each port, no reload
  s19 --> s34: a user changes the look (WCAG AA holds) or a user goes back one step
  s20 --> s21: the tab gets the new kit version#59; the page sends it on each port, no reload
  s20 --> s30: a viewer asks#59; the request keeps this kit version
  s20 --> s31: the page listens for hellos
  s20 --> s35: a user changes the look (WCAG AA holds) or a user goes back one step
  s20 --> s41: a live document starts and says hello
  s21 --> s32: a viewer asks#59; the request keeps this kit version
  s21 --> s33: the page listens for hellos
  s21 --> s35: a user changes the look (WCAG AA holds) or a user goes back one step
  s21 --> s45: a live document starts and says hello
  s22 --> s34: the page listens for hellos
  s22 --> s36: the tab gets the new kit version#59; the page sends it on each port, no reload
  s12 --> s37: a user changes the look (WCAG AA holds)
  s13 --> s38: a user changes the look (WCAG AA holds)
  s14 --> s39: a user changes the look (WCAG AA holds)
  s23 --> s24: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s25 --> s37: a viewer asks#59; the request keeps this kit version
  s25 --> s38: the page listens for hellos
  s25 --> s40: the tab gets the new kit version#59; the page sends it on each port, no reload
  s25 --> s41: a user changes the look (WCAG AA holds) or a user goes back one step
  s26 --> s42: a viewer asks#59; the request keeps this kit version
  s26 --> s43: the page listens for hellos
  s26 --> s41: a user changes the look (WCAG AA holds) or a user goes back one step
  s27 --> s46: the tab gets the new kit version#59; the page sends it on each port, no reload
  s27 --> s47: a user changes the look (WCAG AA holds) or a user goes back one step
  s27 --> s55: a live document starts and says hello
  s28 --> s46: the page listens for hellos
  s28 --> s30: a user changes the look (WCAG AA holds) or a user goes back one step
  s28 --> s64: a live document starts and says hello
  s29 --> s47: a user changes the look (WCAG AA holds) or a user goes back one step
  s29 --> s66: a live document starts and says hello
  s30 --> s47: the page listens for hellos
  s30 --> s48: the tab gets the new kit version#59; the page sends it on each port, no reload
  s30 --> s50: a user changes the look (WCAG AA holds) or a user goes back one step
  s30 --> s59: a live document starts and says hello
  s31 --> s33: the tab gets the new kit version#59; the page sends it on each port, no reload
  s31 --> s47: a viewer asks#59; the request keeps this kit version
  s31 --> s51: a user changes the look (WCAG AA holds) or a user goes back one step
  s31 --> s61: a live document starts and says hello
  s32 --> s49: the page listens for hellos
  s32 --> s50: a user changes the look (WCAG AA holds) or a user goes back one step
  s32 --> s67: a live document starts and says hello
  s33 --> s49: a viewer asks#59; the request keeps this kit version
  s33 --> s51: a user changes the look (WCAG AA holds) or a user goes back one step
  s33 --> s69: a live document starts and says hello
  s34 --> s53: the tab gets the new kit version#59; the page sends it on each port, no reload
  s35 --> s36: the tab gets the new kit version#59; the page sends it on each port, no reload
  s35 --> s50: a viewer asks#59; the request keeps this kit version
  s35 --> s51: the page listens for hellos
  s35 --> s63: a live document starts and says hello
  s36 --> s52: a viewer asks#59; the request keeps this kit version
  s36 --> s53: the page listens for hellos
  s36 --> s70: a live document starts and says hello
  s23 --> s54: a user changes the look (WCAG AA holds)
  s24 --> s55: a user changes the look (WCAG AA holds)
  s37 --> s54: the page listens for hellos
  s37 --> s56: the tab gets the new kit version#59; the page sends it on each port, no reload
  s37 --> s59: a user changes the look (WCAG AA holds) or a user goes back one step
  s38 --> s39: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s38 --> s54: a viewer asks#59; the request keeps this kit version
  s38 --> s58: the tab gets the new kit version#59; the page sends it on each port, no reload
  s38 --> s60: a user changes the look (WCAG AA holds) or a user goes back one step
  s39 --> s44: the tab gets the new kit version#59; the page sends it on each port, no reload
  s39 --> s55: a viewer asks#59; the request keeps this kit version
  s39 --> s61: a user changes the look (WCAG AA holds) or a user goes back one step
  s40 --> s57: a viewer asks#59; the request keeps this kit version
  s40 --> s58: the page listens for hellos
  s40 --> s41: a user changes the look (WCAG AA holds) or a user goes back one step
  s41 --> s59: a viewer asks#59; the request keeps this kit version
  s41 --> s60: the page listens for hellos
  s41 --> s62: the tab gets the new kit version#59; the page sends it on each port, no reload
  s41 --> s63: a user changes the look (WCAG AA holds) or a user goes back one step
  s42 --> s65: the page listens for hellos
  s42 --> s59: a user changes the look (WCAG AA holds) or a user goes back one step
  s43 --> s44: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s43 --> s65: a viewer asks#59; the request keeps this kit version
  s43 --> s60: a user changes the look (WCAG AA holds) or a user goes back one step
  s44 --> s66: a viewer asks#59; the request keeps this kit version
  s44 --> s61: a user changes the look (WCAG AA holds) or a user goes back one step
  s45 --> s67: a viewer asks#59; the request keeps this kit version
  s45 --> s68: the page listens for hellos
  s45 --> s63: a user changes the look (WCAG AA holds) or a user goes back one step
  s46 --> s47: a user changes the look (WCAG AA holds) or a user goes back one step
  s46 --> s87: a live document starts and says hello
  s47 --> s71: the tab gets the new kit version#59; the page sends it on each port, no reload
  s47 --> s72: a user changes the look (WCAG AA holds) or a user goes back one step
  s47 --> s78: a live document starts and says hello
  s48 --> s71: the page listens for hellos
  s48 --> s50: a user changes the look (WCAG AA holds) or a user goes back one step
  s48 --> s88: a live document starts and says hello
  s49 --> s72: a user changes the look (WCAG AA holds) or a user goes back one step
  s49 --> s90: a live document starts and says hello
  s50 --> s72: the page listens for hellos
  s50 --> s73: the tab gets the new kit version#59; the page sends it on each port, no reload
  s50 --> s82: a live document starts and says hello
  s51 --> s53: the tab gets the new kit version#59; the page sends it on each port, no reload
  s51 --> s72: a viewer asks#59; the request keeps this kit version
  s51 --> s84: a live document starts and says hello
  s52 --> s74: the page listens for hellos
  s52 --> s91: a live document starts and says hello
  s53 --> s74: a viewer asks#59; the request keeps this kit version
  s53 --> s93: a live document starts and says hello
  s54 --> s55: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s54 --> s75: the tab gets the new kit version#59; the page sends it on each port, no reload
  s54 --> s77: a user changes the look (WCAG AA holds) or a user goes back one step
  s55 --> s78: a user changes the look (WCAG AA holds) or a user goes back one step
  s55 --> s87: the tab gets the new kit version#59; the page sends it on each port, no reload
  s56 --> s75: the page listens for hellos
  s56 --> s59: a user changes the look (WCAG AA holds) or a user goes back one step
  s57 --> s76: the page listens for hellos
  s57 --> s59: a user changes the look (WCAG AA holds) or a user goes back one step
  s58 --> s44: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s58 --> s76: a viewer asks#59; the request keeps this kit version
  s58 --> s60: a user changes the look (WCAG AA holds) or a user goes back one step
  s59 --> s77: the page listens for hellos
  s59 --> s79: the tab gets the new kit version#59; the page sends it on each port, no reload
  s59 --> s82: a user changes the look (WCAG AA holds) or a user goes back one step
  s60 --> s61: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s60 --> s77: a viewer asks#59; the request keeps this kit version
  s60 --> s81: the tab gets the new kit version#59; the page sends it on each port, no reload
  s60 --> s83: a user changes the look (WCAG AA holds) or a user goes back one step
  s61 --> s69: the tab gets the new kit version#59; the page sends it on each port, no reload
  s61 --> s78: a viewer asks#59; the request keeps this kit version
  s61 --> s84: a user changes the look (WCAG AA holds) or a user goes back one step
  s62 --> s80: a viewer asks#59; the request keeps this kit version
  s62 --> s81: the page listens for hellos
  s62 --> s63: a user changes the look (WCAG AA holds) or a user goes back one step
  s63 --> s82: a viewer asks#59; the request keeps this kit version
  s63 --> s83: the page listens for hellos
  s63 --> s85: the tab gets the new kit version#59; the page sends it on each port, no reload
  s64 --> s86: the page listens for hellos
  s64 --> s59: a user changes the look (WCAG AA holds) or a user goes back one step
  s65 --> s66: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s65 --> s77: a user changes the look (WCAG AA holds) or a user goes back one step
  s66 --> s78: a user changes the look (WCAG AA holds) or a user goes back one step
  s67 --> s89: the page listens for hellos
  s67 --> s82: a user changes the look (WCAG AA holds) or a user goes back one step
  s68 --> s69: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s68 --> s89: a viewer asks#59; the request keeps this kit version
  s68 --> s83: a user changes the look (WCAG AA holds) or a user goes back one step
  s69 --> s90: a viewer asks#59; the request keeps this kit version
  s69 --> s84: a user changes the look (WCAG AA holds) or a user goes back one step
  s70 --> s91: a viewer asks#59; the request keeps this kit version
  s70 --> s92: the page listens for hellos
  s71 --> s72: a user changes the look (WCAG AA holds) or a user goes back one step
  s71 --> s103: a live document starts and says hello
  s72 --> s94: the tab gets the new kit version#59; the page sends it on each port, no reload
  s72 --> s98: a live document starts and says hello
  s73 --> s94: the page listens for hellos
  s73 --> s104: a live document starts and says hello
  s74 --> s106: a live document starts and says hello
  s75 --> s87: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s75 --> s77: a user changes the look (WCAG AA holds) or a user goes back one step
  s76 --> s66: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s76 --> s77: a user changes the look (WCAG AA holds) or a user goes back one step
  s77 --> s78: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s77 --> s95: the tab gets the new kit version#59; the page sends it on each port, no reload
  s77 --> s97: a user changes the look (WCAG AA holds) or a user goes back one step
  s78 --> s98: a user changes the look (WCAG AA holds) or a user goes back one step
  s78 --> s103: the tab gets the new kit version#59; the page sends it on each port, no reload
  s79 --> s95: the page listens for hellos
  s79 --> s82: a user changes the look (WCAG AA holds) or a user goes back one step
  s80 --> s96: the page listens for hellos
  s80 --> s82: a user changes the look (WCAG AA holds) or a user goes back one step
  s81 --> s69: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s81 --> s96: a viewer asks#59; the request keeps this kit version
  s81 --> s83: a user changes the look (WCAG AA holds) or a user goes back one step
  s82 --> s97: the page listens for hellos
  s82 --> s99: the tab gets the new kit version#59; the page sends it on each port, no reload
  s83 --> s84: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s83 --> s97: a viewer asks#59; the request keeps this kit version
  s83 --> s101: the tab gets the new kit version#59; the page sends it on each port, no reload
  s84 --> s93: the tab gets the new kit version#59; the page sends it on each port, no reload
  s84 --> s98: a viewer asks#59; the request keeps this kit version
  s85 --> s100: a viewer asks#59; the request keeps this kit version
  s85 --> s101: the page listens for hellos
  s86 --> s87: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s86 --> s77: a user changes the look (WCAG AA holds) or a user goes back one step
  s87 --> s78: a user changes the look (WCAG AA holds) or a user goes back one step
  s88 --> s102: the page listens for hellos
  s88 --> s82: a user changes the look (WCAG AA holds) or a user goes back one step
  s89 --> s90: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s89 --> s97: a user changes the look (WCAG AA holds) or a user goes back one step
  s90 --> s98: a user changes the look (WCAG AA holds) or a user goes back one step
  s91 --> s105: the page listens for hellos
  s92 --> s93: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s92 --> s105: a viewer asks#59; the request keeps this kit version
  s93 --> s106: a viewer asks#59; the request keeps this kit version
  s94 --> s110: a live document starts and says hello
  s95 --> s103: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s95 --> s97: a user changes the look (WCAG AA holds) or a user goes back one step
  s96 --> s90: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s96 --> s97: a user changes the look (WCAG AA holds) or a user goes back one step
  s97 --> s98: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s97 --> s107: the tab gets the new kit version#59; the page sends it on each port, no reload
  s98 --> s110: the tab gets the new kit version#59; the page sends it on each port, no reload
  s99 --> s107: the page listens for hellos
  s100 --> s108: the page listens for hellos
  s101 --> s93: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s101 --> s108: a viewer asks#59; the request keeps this kit version
  s102 --> s103: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s102 --> s97: a user changes the look (WCAG AA holds) or a user goes back one step
  s103 --> s98: a user changes the look (WCAG AA holds) or a user goes back one step
  s104 --> s109: the page listens for hellos
  s105 --> s106: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s107 --> s110: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s108 --> s106: the document says hello again (50 ms)#59; the page gives it a port and the kit
  s109 --> s110: the document says hello again (50 ms)#59; the page gives it a port and the kit
  class s0 tan
  class s1 tan
  class s2 tan
  class s3 teal
  class s4 tan
  class s5 blue
  class s6 tan
  class s7 teal
  class s8 blue
  class s9 yellow
  class s10 blue
  class s11 blue
  class s12 teal
  class s13 tan
  class s14 tan
  class s15 teal
  class s16 yellow
  class s17 teal
  class s18 blue
  class s19 blue
  class s20 yellow
  class s21 blue
  class s22 blue
  class s23 teal
  class s24 teal
  class s25 orange
  class s26 blue
  class s27 teal
  class s28 teal
  class s29 teal
  class s30 teal
  class s31 yellow
  class s32 teal
  class s33 blue
  class s34 blue
  class s35 yellow
  class s36 blue
  class s37 orange
  class s38 orange
  class s39 yellow
  class s40 orange
  class s41 orange
  class s42 teal
  class s43 blue
  class s44 blue
  class s45 blue
  class s46 teal
  class s47 teal
  class s48 teal
  class s49 teal
  class s50 teal
  class s51 yellow
  class s52 teal
  class s53 blue
  class s54 orange
  class s55 teal
  class s56 orange
  class s57 orange
  class s58 orange
  class s59 orange
  class s60 orange
  class s61 yellow
  class s62 orange
  class s63 orange
  class s64 teal
  class s65 teal
  class s66 teal
  class s67 teal
  class s68 blue
  class s69 blue
  class s70 blue
  class s71 teal
  class s72 teal
  class s73 teal
  class s74 teal
  class s75 orange
  class s76 orange
  class s77 orange
  class s78 teal
  class s79 orange
  class s80 orange
  class s81 orange
  class s82 orange
  class s83 orange
  class s84 yellow
  class s85 orange
  class s86 teal
  class s87 teal
  class s88 teal
  class s89 teal
  class s90 teal
  class s91 teal
  class s92 blue
  class s93 blue
  class s94 teal
  class s95 orange
  class s96 orange
  class s97 orange
  class s98 teal
  class s99 orange
  class s100 orange
  class s101 orange
  class s102 teal
  class s103 teal
  class s104 teal
  class s105 teal
  class s106 teal
  class s107 orange
  class s108 orange
  class s109 teal
  class s110 teal
```

| Rule                                  | In plain words                                                                                                                                                                                                                                 | Spec line                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `TypeOK`                              | Each value is one the store, a tab or a writer can hold.                                                                                                                                                                                       | (model)                                                                                  |
| `AChangeOnAnOldRevisionIsNeverSaved`  | A change lands only on the revision its writer read, so of two changes on one revision the second answers `stale`, and no change is lost.                                                                                                      | SPEC-kit.md § Add to the kit, step 5, and judged rule 2 (K14)                            |
| `ARefusalWritesNothing`               | A `stale` or `unreadable` answer changes no look, no piece and no kit version.                                                                                                                                                                 | SPEC-kit.md, judged rule 1                                                               |
| `EachChangeMakesOneKitVersion`        | Each change of the look or of a piece makes exactly one new kit version.                                                                                                                                                                       | SPEC-kit.md, judged rule 3 (K7, K13)                                                     |
| `TheNewestKitVersionIsTheStoredOne`   | The current kit version holds the stored look and the stored piece.                                                                                                                                                                            | SPEC-kit.md, judged rule 4                                                               |
| `AKitVersionNeverChanges`             | A kit version never changes after it is written, and none goes away.                                                                                                                                                                           | SPEC-kit.md, judged rule 4 (K10, K11)                                                    |
| `NoStoredLookIsUnreadable`            | No kit version holds a look whose text fails WCAG AA.                                                                                                                                                                                          | SPEC-kit.md, judged rule 7 (K8)                                                          |
| `UndoGivesTheLookBefore`              | One step back gives the look from before the last change of the look, as a new kit version.                                                                                                                                                    | SPEC-kit.md § Change the look, step 6, and judged rule 8 (K9)                            |
| `ATabShowsOnlyAStoredKitVersion`      | A tab shows only a kit version that is stored.                                                                                                                                                                                                 | SPEC-kit.md, judged rule 6                                                               |
| `ATabNeverGoesBack`                   | A tab never goes back to an older kit version.                                                                                                                                                                                                 | SPEC-kit.md, judged rule 6 (K7)                                                          |
| `TheBeforeShowsWhatTheViewerSaw`      | The Before of a request shows the look and the kit that the viewer saw when they asked, after any later change.                                                                                                                                | SPEC-kit.md § Change the look, step 7, and SPEC-queue.md (K10)                           |
| `ADocumentShowsOnlyAStoredKitVersion` | A live document shows only a kit version that is stored.                                                                                                                                                                                       | SPEC-kit.md § compose (K7)                                                               |
| `ADocumentNeverGoesBack`              | A live document never goes back to an older kit version.                                                                                                                                                                                       | SPEC-kit.md § compose (K7)                                                               |
| `ALiveDocumentShowsTheNewLook`        | Each live document comes to show the newest kit version with no reload, also one that started before the page listened: its piece script says hello each 50 ms until the page gives it a port, and the page sends each later kit on that port. | SPEC-kit.md § Change the look, step 3, and § compose; SPEC-viewer.md judged rule 12 (K7) |
| `NoDeadlock`                          | There is always a next step.                                                                                                                                                                                                                   | (model)                                                                                  |

## What the model leaves out

- More than one piece and more than two writers: each piece acts the same, and two writers are enough for a race.
- The board's cell set after the row: the frames model ([frames-writes](frames-writes.md)) shows that pattern; here a tab reads the stored kit version in one step.
- The `taken`, `gone`, `offLook`, `tooBig`, `unchanged` and `invalid` answers. `unreadable` is a step that changes nothing, so it draws no arrow.
- Frames: no frame is written by a change of the kit, so the model has no frame. The picture of a frame in a kit version is in [frames-pictures](frames-pictures.md).
- The make step and `compose`: a kit version holds its made CSS, and `compose` adds stored text
  only (SPEC-kit judged rules 5 and 9).
- More than one live document, and a document that reloads: each acts as the one here, and a new
  iframe is a new document that says hello again.
- The 1 s of K7: the model says that the document comes to show the kit, not how fast. The browser
  test measures the time.
- A hello from a window that is not one of the page's own live iframes: the page does not answer
  it (SPEC-viewer judged rule 12), so it changes nothing.
