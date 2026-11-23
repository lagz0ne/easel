import { tag } from "@tinkered/core";

export const httpBackend = tag<
  (input: string | URL | Request, init?: RequestInit) => Promise<Response>
>({
  label: "http.backend",
  default: (input, init) => fetch(input, init),
});
