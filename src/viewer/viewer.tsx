import { useData, useRun } from "@tinkered/react";

import { Canvas } from "./canvas";
import { enterPassword, gates } from "./gate";
import type { Gate } from "./gate";
import { KeptText } from "./request";

function Ended() {
  return (
    <main>
      <h1>This link does not work</h1>
      <p>It has ended, or it is wrong. Ask the person who shared it for a new link.</p>
      <KeptText />
    </main>
  );
}

const alerts = {
  wrong: "That password is wrong.",
  wait: "Too many wrong passwords. Wait 1 minute, then try again. Until then, no password opens the link.",
} as const;

const passwordTexts = {
  first: {
    heading: "This link needs a password",
    text: "Ask the person who shared it for the password.",
  },
  changed: {
    heading: "The password of this link changed",
    text: "Enter the new password to see the canvas again. Ask the person who shared it.",
  },
} as const;

type PasswordPage = Extract<Gate, { page: "password" }>;

function PasswordGate({ link, alert, changed }: Omit<PasswordPage, "page">) {
  const enter = useRun(enterPassword);
  const says = passwordTexts[changed ? "changed" : "first"];
  return (
    <main>
      <h1>{says.heading}</h1>
      <p>{says.text}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const password = new FormData(event.currentTarget).get("password");
          if (typeof password === "string" && password) enter.run({ input: { link, password } });
        }}
      >
        <input name="password" type="password" aria-label="Password" required />
        <button type="submit" disabled={enter.isPending && alert !== "wait"}>
          Open
        </button>
      </form>
      {alert === "none" ? null : <p role="alert">{alerts[alert]}</p>}
      {enter.error ? <p role="alert">No answer. Try again.</p> : null}
      <KeptText />
    </main>
  );
}

export function Opening() {
  return (
    <main className="e-canvas e-light">
      <p role="status" className="e-unseen">
        Opening the link
      </p>
    </main>
  );
}

export function Viewer({ link }: { link: string }) {
  const gate = useData(gates.of({ link }));
  switch (gate?.page) {
    case undefined:
      return <Opening />;
    case "password":
      return <PasswordGate link={link} alert={gate.alert} changed={gate.changed} />;
    case "canvas":
      return <Canvas canvas={gate.canvas} opening={<Opening />} />;
    case "ended":
      return <Ended />;
  }
}
