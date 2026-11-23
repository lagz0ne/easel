import type { MainClosed, MainContext, MainStarted } from "@tinkered/bun";

export type { MainClosed, MainContext, MainStarted };

export const defineMain = <R extends MainStarted>(main: (ctx: MainContext) => R | Promise<R>) =>
  main;
