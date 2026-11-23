import { data, tag } from "@tinkered/core";
import { z } from "zod";

export const planShape = z.object({
  id: z.string(),
  name: z.string().min(1),
  price: z.number().nonnegative(),
  features: z.array(z.string()),
});

export type Plan = z.infer<typeof planShape>;

export const sampleShape = z.enum(["empty", "one", "many", "long"]);

export type Sample = z.infer<typeof sampleShape>;

export const samples: Record<Sample, Plan[]> = {
  empty: [],
  one: [{ id: "pro", name: "Pro", price: 29, features: ["10 projects", "Chat support"] }],
  many: [
    { id: "starter", name: "Starter", price: 9, features: ["1 project"] },
    { id: "pro", name: "Pro", price: 29, features: ["10 projects", "Chat support"] },
    { id: "team", name: "Team", price: 79, features: ["All projects", "A named contact"] },
  ],
  long: [
    {
      id: "enterprise",
      name: "Enterprise with a very long name for the procurement team",
      price: 12_500,
      features: Array.from({ length: 8 }, (_, i) => `Feature number ${i + 1} of the plan`),
    },
  ],
};

export const sample = tag<Sample>({ label: "pricing.sample", default: "many", parse: sampleShape });

export const plans = data<Plan[]>({ label: "pricing.plans", initial: [] });

export const chosen = data<string | null>({ label: "pricing.chosen", initial: null });
