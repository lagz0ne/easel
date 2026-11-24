import { z } from "zod";

export const runtimeNames = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@tinkered/core",
  "@tinkered/react",
  "zod",
  "@base-ui/react",
  "@base-ui/react/accordion",
  "@base-ui/react/alert-dialog",
  "@base-ui/react/autocomplete",
  "@base-ui/react/avatar",
  "@base-ui/react/button",
  "@base-ui/react/checkbox",
  "@base-ui/react/checkbox-group",
  "@base-ui/react/collapsible",
  "@base-ui/react/combobox",
  "@base-ui/react/context-menu",
  "@base-ui/react/csp-provider",
  "@base-ui/react/dialog",
  "@base-ui/react/direction-provider",
  "@base-ui/react/drawer",
  "@base-ui/react/field",
  "@base-ui/react/fieldset",
  "@base-ui/react/form",
  "@base-ui/react/input",
  "@base-ui/react/menu",
  "@base-ui/react/menubar",
  "@base-ui/react/merge-props",
  "@base-ui/react/meter",
  "@base-ui/react/navigation-menu",
  "@base-ui/react/number-field",
  "@base-ui/react/otp-field",
  "@base-ui/react/popover",
  "@base-ui/react/preview-card",
  "@base-ui/react/progress",
  "@base-ui/react/radio",
  "@base-ui/react/radio-group",
  "@base-ui/react/scroll-area",
  "@base-ui/react/select",
  "@base-ui/react/separator",
  "@base-ui/react/slider",
  "@base-ui/react/switch",
  "@base-ui/react/tabs",
  "@base-ui/react/toast",
  "@base-ui/react/toggle",
  "@base-ui/react/toggle-group",
  "@base-ui/react/toolbar",
  "@base-ui/react/tooltip",
  "@base-ui/react/use-render",
  "lucide-react",
  "clsx",
  "class-variance-authority",
  "tailwind-merge",
  "@easel/frame",
  "@easel/kit",
] as const;

export const runtimePrefix = "/api/runtime/";

export const runtimeSha = z.string().regex(/^[0-9a-f]{64}$/, "not a runtime's SHA-256");

export const runtimeFile = z.string().regex(/^[a-z0-9_-]+\.js$/, "not a runtime file");

export const runtimeLink = z.object({
  address: z.string(),
  imports: z.record(z.string(), runtimeFile),
});

export type RuntimeLink = z.infer<typeof runtimeLink>;
