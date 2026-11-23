import type { ErrorComponentProps } from "@tanstack/react-router";

import { ErrorDetails } from "./panics";

export function TinkerError({ error }: ErrorComponentProps) {
  return <ErrorDetails error={error} dev={process.env.NODE_ENV !== "production"} />;
}

export function TinkerNotFound() {
  return (
    <main>
      <h1>Not found</h1>
    </main>
  );
}
