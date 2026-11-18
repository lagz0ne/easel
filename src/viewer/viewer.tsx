import { useData, useRun } from "@tinkered/react";

import { Canvas } from "./canvas";
import { enterPassword, gates, giveName } from "./gate";
import type { Gate } from "./gate";

// `/s/<link>`: the share link's page (SPEC-viewer.md; the viewer-gate-password chart). No state of
// its own: the gate cell says which page the tab is on, and the canvas reads the live board. The
// canvas's only controls are Zoom in, Zoom out and Fit (the chart's CanvasControls).

/** The page that says the link has ended, and nothing else (judged rule 13). */
function Ended() {
  return (
    <main>
      <h1>This link has ended</h1>
      <p>Ask whoever shared it for a new one.</p>
    </main>
  );
}

/** The name gate: asked once per browser, before the link opens. */
function NameGate({ link }: { link: string }) {
  const give = useRun(giveName);
  return (
    <main>
      <h1>Who is looking?</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const name = new FormData(event.currentTarget).get("name");
          if (typeof name === "string" && name.trim()) give.run({ input: { link, name } });
        }}
      >
        <input name="name" aria-label="Your name" maxLength={40} required />
        <button type="submit" disabled={give.isPending}>
          Continue
        </button>
      </form>
      {give.error ? <p role="alert">No answer. Try again.</p> : null}
    </main>
  );
}

/** What the password page's `alert` says. */
const alerts = {
  wrong: "That password is wrong.",
  wait: "Too many wrong passwords. Wait a minute, then try again.",
} as const;

/** The password gate: textbox Password, button Open, and an alert after a wrong one. */
function PasswordGate({
  link,
  alert,
}: {
  link: string;
  alert: Extract<Gate, { page: "password" }>["alert"];
}) {
  const enter = useRun(enterPassword);
  return (
    <main>
      <h1>This link asks a password</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const password = new FormData(event.currentTarget).get("password");
          if (typeof password === "string" && password) enter.run({ input: { link, password } });
        }}
      >
        <input name="password" type="password" aria-label="Password" required />
        {/* While it says to wait, Open still calls: the link may have ended (the chart's s6 to s4). */}
        <button type="submit" disabled={enter.isPending && alert !== "wait"}>
          Open
        </button>
      </form>
      {alert === "none" ? null : <p role="alert">{alerts[alert]}</p>}
      {enter.error ? <p role="alert">No answer. Try again.</p> : null}
    </main>
  );
}

/** The link is still opening: the first call, or a call again after a flood `slow`. */
export function Opening() {
  return <p role="status">Opening.</p>;
}

/** The link's page: opening, the name gate, the password gate, the canvas, or ended. */
export function Viewer({ link }: { link: string }) {
  const gate = useData(gates.of({ link }));
  switch (gate?.page) {
    case undefined:
      return <Opening />;
    case "name":
      return <NameGate link={link} />;
    case "password":
      return <PasswordGate link={link} alert={gate.alert} />;
    case "canvas":
      return <Canvas canvas={gate.canvas} opening={<Opening />} />;
    case "ended":
      return <Ended />;
  }
}
