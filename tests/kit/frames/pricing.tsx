// A usual app frame (SPEC-kit.md § App frames): logic and View, the kit's classes and Tailwind
// utilities in the class places only. The check finds nothing in it.
import { data, operation } from "@tinkered/core";
import { useData, useRun } from "@tinkered/react";
import { cn, frameLogic } from "@easel/frame";
import { cva } from "class-variance-authority";
import { clsx } from "clsx";
import { Check } from "lucide-react";
import { z } from "zod";

type Period = "month" | "year";

const period = data<Period>({ label: "pricing.period", initial: "month" });
const chosen = data<string | null>({ label: "pricing.chosen", initial: null });

const pick = operation({
  label: "pricing.pick",
  input: z.enum(["month", "year"]),
  depends: { period: period.controller },
  run: ({ period }, { input }) => period.set(input),
});

const choose = operation({
  label: "pricing.choose",
  input: z.string(),
  depends: { chosen: chosen.controller },
  run: ({ chosen }, { input }) => chosen.set(input),
});

export const logic = frameLogic({ cells: { period, chosen }, ops: { pick, choose } });

const plan = cva("card flex flex-col gap-6 p-6", {
  variants: {
    featured: {
      true: "border-primary shadow-md ring-2 ring-ring",
      false: "border-border",
    },
    size: { sm: "gap-4 p-4", lg: ["gap-8", "p-8 md:p-10"] },
  },
  compoundVariants: [{ featured: true, size: "lg", className: "md:-translate-y-2" }],
  defaultVariants: { featured: false, size: "sm" },
});

const tone = {
  month: "bg-primary text-primary-foreground",
  year: "bg-muted text-muted-foreground",
} as const;

const label = "text-sm font-medium text-muted-foreground";

const plans = [
  { name: "Starter", month: "$9", year: "$90", features: ["1 project", "Email support"] },
  { name: "Pro", month: "$29", year: "$290", features: ["10 projects", "Chat support", "Reports"] },
  { name: "Team", month: "$79", year: "$790", features: ["All projects", "A named contact"] },
];

function Feature({ text, className }: { text: string; className?: string }) {
  return (
    <li className={cn("flex items-center gap-2 text-sm", className)}>
      <Check className="size-4 text-success" aria-hidden />
      {text}
    </li>
  );
}

function Switch({ now }: { now: Period }) {
  const { run } = useRun(logic.ops.pick);
  return (
    <div className="tabs inline-flex rounded-lg bg-muted p-1" role="tablist">
      {(["month", "year"] as const).map((p) => (
        <button
          key={p}
          type="button"
          role="tab"
          aria-selected={now === p}
          className={clsx(
            "rounded-md px-4 py-1.5 text-sm",
            now === p && tone[p],
            { "font-semibold": now === p, "opacity-70": now !== p },
          )}
          onClick={() => run({ input: p })}
        >
          {p === "month" ? "Monthly" : "Yearly"}
        </button>
      ))}
    </div>
  );
}

export function View() {
  const now = useData(logic.cells.period);
  const picked = useData(logic.cells.chosen);
  const { run } = useRun(logic.ops.choose);

  return (
    <main className="mx-auto flex max-w-5xl flex-col items-center gap-10 px-6 py-16">
      <header className="flex flex-col items-center gap-3 text-center">
        <span className="badge badge-info">Pricing</span>
        <h1 className="font-display text-4xl font-semibold tracking-tight">Plans for each team</h1>
        <p className={label}>Start free. Change your plan at any time.</p>
        <Switch now={now} />
      </header>
      <section className="grid w-full gap-6 md:grid-cols-3">
        {plans.map((p) => (
          <article
            key={p.name}
            className={plan({ featured: p.name === "Pro", size: p.name === "Pro" ? "lg" : "sm" })}
          >
            <h2 className="text-lg font-semibold">{p.name}</h2>
            <p>
              <strong className="text-4xl font-semibold">{now === "month" ? p.month : p.year}</strong>{" "}
              <span className="text-muted-foreground">/ {now}</span>
            </p>
            <ul className="flex flex-1 flex-col gap-2">
              {p.features.map((f) => (
                <Feature key={f} text={f} className={p.name === "Pro" ? "font-medium" : undefined} />
              ))}
            </ul>
            <button
              type="button"
              className={cn("btn w-full", p.name === "Pro" ? "btn-primary" : "btn-ghost")}
              onClick={() => run({ input: p.name })}
            >
              {picked === p.name ? "Chosen" : `Choose ${p.name}`}
            </button>
          </article>
        ))}
      </section>
      <footer className={cn(label, "mx-auto text-center")}>
        Prices are in US dollars. A year is two months free.
      </footer>
    </main>
  );
}
