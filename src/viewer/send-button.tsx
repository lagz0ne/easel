export function SendButton({ busy, off = false }: { busy: boolean; off?: boolean }) {
  return (
    <button
      type="submit"
      className="e-send"
      aria-label="Send"
      aria-busy={busy}
      disabled={busy || off}
    >
      {busy ? (
        <span className="e-spin" aria-hidden="true" />
      ) : (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
        </svg>
      )}
    </button>
  );
}

export function SendingLine({ busy }: { busy: boolean }) {
  return busy ? (
    <p className="e-hint" role="status">
      Sending…
    </p>
  ) : null;
}
