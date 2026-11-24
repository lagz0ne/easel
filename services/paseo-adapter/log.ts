export type Fields = Record<string, string | number | boolean | null>;

export function log(event: string, fields: Fields = {}) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`);
}
