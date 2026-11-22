import { operation } from "@tinkered/core";

import { kitShape } from "./schema";

// The Tailwind source of a kit version (SPEC-kit.md § The make step, "The theme").
//
// The look's namespaces (color, font, text, radius, shadow, spacing) map each class to a look value
// with `@theme inline reference`, so made CSS holds `var(--primary)` and defines no look value. No
// default palette and no default scale of these namespaces is in the source: Tailwind's
// `theme.css` is not imported, so only the names of the look give CSS.
//
// The other namespaces keep Tailwind's values, fixed here: a copy of the values of
// `tailwindcss/theme.css` 4.3.5 (MIT, Tailwind Labs), with no change. `inline` puts each value in
// the made CSS, so a frame's CSS needs no theme variable. A namespace that is not here gives no
// CSS, and the check finds it.

/** The namespaces that the look does not hold: Tailwind's values, fixed by the kit source. */
export const fixedTheme = `@theme inline reference {
  --breakpoint-sm: 40rem;
  --breakpoint-md: 48rem;
  --breakpoint-lg: 64rem;
  --breakpoint-xl: 80rem;
  --breakpoint-2xl: 96rem;
  --container-3xs: 16rem;
  --container-2xs: 18rem;
  --container-xs: 20rem;
  --container-sm: 24rem;
  --container-md: 28rem;
  --container-lg: 32rem;
  --container-xl: 36rem;
  --container-2xl: 42rem;
  --container-3xl: 48rem;
  --container-4xl: 56rem;
  --container-5xl: 64rem;
  --container-6xl: 72rem;
  --container-7xl: 80rem;
  --font-weight-thin: 100;
  --font-weight-extralight: 200;
  --font-weight-light: 300;
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
  --font-weight-extrabold: 800;
  --font-weight-black: 900;
  --tracking-tighter: -0.05em;
  --tracking-tight: -0.025em;
  --tracking-normal: 0em;
  --tracking-wide: 0.025em;
  --tracking-wider: 0.05em;
  --tracking-widest: 0.1em;
  --leading-tight: 1.25;
  --leading-snug: 1.375;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;
  --leading-loose: 2;
  --inset-shadow-2xs: inset 0 1px rgb(0 0 0 / 0.05);
  --inset-shadow-xs: inset 0 1px 1px rgb(0 0 0 / 0.05);
  --inset-shadow-sm: inset 0 2px 4px rgb(0 0 0 / 0.05);
  --drop-shadow-xs: 0 1px 1px rgb(0 0 0 / 0.05);
  --drop-shadow-sm: 0 1px 2px rgb(0 0 0 / 0.15);
  --drop-shadow-md: 0 3px 3px rgb(0 0 0 / 0.12);
  --drop-shadow-lg: 0 4px 4px rgb(0 0 0 / 0.15);
  --drop-shadow-xl: 0 9px 7px rgb(0 0 0 / 0.1);
  --drop-shadow-2xl: 0 25px 25px rgb(0 0 0 / 0.15);
  --text-shadow-2xs: 0px 1px 0px rgb(0 0 0 / 0.15);
  --text-shadow-xs: 0px 1px 1px rgb(0 0 0 / 0.2);
  --text-shadow-sm: 0px 1px 0px rgb(0 0 0 / 0.075), 0px 1px 1px rgb(0 0 0 / 0.075), 0px 2px 2px rgb(0 0 0 / 0.075);
  --text-shadow-md: 0px 1px 1px rgb(0 0 0 / 0.1), 0px 1px 2px rgb(0 0 0 / 0.1), 0px 2px 4px rgb(0 0 0 / 0.1);
  --text-shadow-lg: 0px 1px 2px rgb(0 0 0 / 0.1), 0px 3px 2px rgb(0 0 0 / 0.1), 0px 4px 8px rgb(0 0 0 / 0.1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --animate-spin: spin 1s linear infinite;
  --animate-ping: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;
  --animate-pulse: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  --animate-bounce: bounce 1s infinite;
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes ping {
    75%,
    100% {
      transform: scale(2);
      opacity: 0;
    }
  }
  @keyframes pulse {
    50% {
      opacity: 0.5;
    }
  }
  @keyframes bounce {
    0%,
    100% {
      transform: translateY(-25%);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    50% {
      transform: none;
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
  }
  --blur-xs: 4px;
  --blur-sm: 8px;
  --blur-md: 12px;
  --blur-lg: 16px;
  --blur-xl: 24px;
  --blur-2xl: 40px;
  --blur-3xl: 64px;
  --perspective-dramatic: 100px;
  --perspective-near: 300px;
  --perspective-normal: 500px;
  --perspective-midrange: 800px;
  --perspective-distant: 1200px;
  --aspect-video: 16 / 9;
  --default-transition-duration: 150ms;
  --default-transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}
`;

/** The look's CSS names that are not colors: each maps to the Tailwind name that is the same. */
const sameName = /^--(?:text|radius|shadow|font)-|^--spacing$/;

/**
 * The two Tailwind sources of a kit version. `kit`: the theme, the kit's own CSS and all
 * utilities: the design system of the check, and (from step 2) the kit version's made CSS.
 * `frame`: the theme and the layer `utilities` only, so a frame version holds only its utilities.
 */
export const sources = operation({
  label: "kit.sources",
  input: kitShape,
  run: (_, { input }) => {
    const names = Object.keys(input.look).sort();
    const look = names.map((name) =>
      sameName.test(name)
        ? `  ${name}: var(${name});`
        : `  --color-${name.slice(2)}: var(${name});`,
    );
    // White and black are allowed with no look value (judged rule 12).
    if (!names.includes("--white")) look.push("  --color-white: #fff;");
    if (!names.includes("--black")) look.push("  --color-black: #000;");

    const theme = `${fixedTheme}@theme inline reference {\n${look.join("\n")}\n}\n`;
    const utilities = "@layer utilities {\n  @tailwind utilities;\n}\n";
    return {
      kit: `@layer theme, base, components, utilities;\n${theme}${input.css}\n${utilities}`,
      frame: `${theme}${utilities}`,
    };
  },
});
