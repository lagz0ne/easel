import { z } from "zod";

export const queueEnv = z
  .object({ EASEL_AGREEMENT: z.string().optional() })
  .transform((env) => ({ agreement: env.EASEL_AGREEMENT?.trim() !== "off" }));
