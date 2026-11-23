import { capsule, resource, tag } from "@tinkered/core";
import { clsx } from "clsx";
import type { ReactNode } from "react";

import { contrast } from "@/kit/compose";

import { aboutShape } from "./about";
import { copy, type Texts } from "./copy";
import { look } from "./look";

const about = tag({ label: "ui.about", parse: aboutShape });

const texts = {
  en: {
    "ui.empty": "Nothing here yet",
    "ui.close": "Close",
  },
  vi: {
    "ui.empty": "Chưa có gì",
    "ui.close": "Đóng",
  },
} satisfies Texts;

const text = resource({
  label: "ui.text",
  tags: [copy.texts(texts)],
  depends: { say: copy.say },
  factory: ({ say }) => say(texts),
});

const tones = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-danger",
} as const;

const badges = {
  plain: "",
  info: "badge-info",
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
} as const;

type ButtonProps = {
  tone?: keyof typeof tones;
  small?: boolean;
  wide?: boolean;
  disabled?: boolean;
  label?: string;
  onClick?: () => void;
  children: ReactNode;
};

const pieces = resource({
  label: "ui.pieces",
  depends: { t: text },
  factory: ({ t }) => ({
    Button: ({
      tone = "primary",
      small,
      wide,
      disabled,
      label,
      onClick,
      children,
    }: ButtonProps) => (
      <button
        type="button"
        className={clsx("btn", tones[tone], small && "btn-sm", wide && "w-full")}
        disabled={disabled}
        aria-label={label}
        onClick={onClick}
      >
        {children}
      </button>
    ),
    Card: ({ title, children }: { title?: ReactNode; children: ReactNode }) => (
      <section className="card">
        {title === undefined ? null : <h2>{title}</h2>}
        {children}
      </section>
    ),
    Badge: ({ tone = "plain", children }: { tone?: keyof typeof badges; children: ReactNode }) => (
      <span className={clsx("badge", badges[tone])}>{children}</span>
    ),
    Stat: ({ label, value }: { label: ReactNode; value: ReactNode }) => (
      <div className="stat">
        <span className="stat-label">{label}</span>
        <span className="stat-value">{value}</span>
      </div>
    ),
    Empty: ({ children }: { children?: ReactNode }) => (
      <div className="empty">
        <p>{t("ui.empty")}</p>
        {children}
      </div>
    ),
  }),
});

export const ui = capsule({
  label: "ui",
  tags: [
    about({
      does: "The pieces of the kit: React components with the kit's classes. Its start stops the scope when the look fails K8.",
      install: "easel installs it for each frame, after look and copy.",
      exports: {
        pieces: {
          does: "Button, Card, Badge, Stat and Empty: compose them, and do not style them.",
          use: [
            "depends: { ui: ui.pieces } then factory: ({ ui: { Button, Card, Badge, Stat, Empty } }) => function View() { ... }",
            '<Button tone="primary|secondary|ghost|danger" small wide disabled label="<aria label>" onClick={...}>Save</Button>',
            '<Card title="Plans">...</Card>',
            '<Badge tone="plain|info|success|warning|danger">New</Badge>',
            '<Stat label="Revenue" value="$1,200" />',
            "<Empty>{optional action}</Empty> // its text is ui.empty",
          ].join("\n"),
        },
        text: {
          does: "The t of the pieces, in the locale of the scope.",
          use: "The pieces use it; a frame uses its own text.",
        },
      },
    }),
  ],
  exports: { pieces, text },
  hooks: {
    async start({ load, run, raise, next }) {
      const setup = {
        role: "setup" as const,
        explain: "The pieces need a look that meets K8",
      };
      const values = await load(look.values, setup);
      const styles = await load(look.styles, setup);
      const pairs = await run(contrast, { input: { look: values, css: styles } }, setup);
      const low = pairs.filter((pair) => !(pair.ratio >= pair.min));
      if (low.length > 0) raise("LookFailsK8", { pairs: low });

      await next();
    },
  },
});
