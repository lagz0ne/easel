import { z } from "zod";

import { projectName } from "./contract";

export const homeEnv = z
  .object({
    EASEL_PROJECT: z
      .string()
      .optional()
      .transform((raw) => raw?.trim() || null)
      .pipe(projectName.nullable()),
  })
  .transform((env) => ({ project: env.EASEL_PROJECT }));
