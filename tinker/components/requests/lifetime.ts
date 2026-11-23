import { tag, transport } from "@tinkered/core";

export const backendStop = tag<AbortSignal>({ label: "lifetime.backendStop" });

export const requestStop = transport.requestStop;
