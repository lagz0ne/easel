import { rpc } from "@tinkered/core";
import { z } from "zod";

export const greetApi = rpc({
  greet: { input: z.object({ name: z.string().min(1) }), output: z.object({ text: z.string() }) },
});
