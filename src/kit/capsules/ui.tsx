import { capsule, resource, tag } from "@tinkered/core";
import { clsx } from "clsx";
import type { ReactNode } from "react";

import { contrast } from "@/kit/compose";

import { aboutShape } from "./about";
import { copy, type Texts } from "./copy";
import { look } from "./look";

// The pieces of the kit as a capsule (docs/decisions/kit-capsules.md): React components that use
// the kit's classes, made from the copy that the scope installs. A frame composes them and does
// not style them. Its start checks what the pieces need before any frame draws: the look meets
// K8 (the contrast of each text and edge). Their texts are a part of the copy (`ui.text`).

const about = tag({ label: "ui.about", parse: aboutShape });

/** The texts of the pieces. */
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

/** The `t` of the pieces: their texts in the locale of the scope. */
const text = resource({
  label: "ui.text",
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

/** The pieces: Button, Card, Badge, Stat and Empty. */
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
      exports: {
        pieces: "Button, Card, Badge, Stat and Empty.",
        text: "The t of the pieces, in the locale of the scope.",
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
