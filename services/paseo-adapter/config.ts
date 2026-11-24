import { homedir } from "node:os";
import { join } from "node:path";

export type Config = {
  url: string;
  seedFile: string;
  inbox: string;
  stream: string;
  consumer: string;
  paseo: string;
  workspaceDir: string;
  provider: string;
  mode: string;
  stateDir: string;
  maxRunning: number;
  maxPerDay: number;
  pollMs: number;
  nakMs: number;
  permitMs: number;
};

type Env = Record<string, string | undefined>;

const positiveNumber = (env: Env, name: string, fallback: number) => {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a number above 0, not "${raw}"`);
  }
  return value;
};

export function configFrom(env: Env): Config {
  const home = env.HOME ?? homedir();
  const text = (name: string, fallback: string) => env[name] || fallback;

  return {
    url: text("EASEL_PASEO_NATS_URL", "nats://127.0.0.1:4222"),
    seedFile: text("EASEL_PASEO_SEED_FILE", join(home, ".config/secrets/hub-nats/easel-paseo.nk")),
    inbox: text("EASEL_PASEO_INBOX", "_INBOX_easel_paseo"),
    stream: text("EASEL_PASEO_STREAM", "EASEL_REQUESTS"),
    consumer: text("EASEL_PASEO_CONSUMER", "paseo"),
    paseo: text("EASEL_PASEO_BIN", "paseo"),
    workspaceDir: text("EASEL_PASEO_WORKSPACE_DIR", join(home, "dev/easel")),
    provider: text("EASEL_PASEO_PROVIDER", "claude"),
    mode: text("EASEL_PASEO_MODE", "auto"),
    stateDir: text("EASEL_PASEO_STATE_DIR", join(home, ".local/state/easel-paseo-adapter")),
    maxRunning: positiveNumber(env, "EASEL_PASEO_MAX_RUNNING", 2),
    maxPerDay: positiveNumber(env, "EASEL_PASEO_MAX_PER_DAY", 20),
    pollMs: positiveNumber(env, "EASEL_PASEO_POLL_MS", 5000),
    nakMs: positiveNumber(env, "EASEL_PASEO_NAK_MS", 60_000),
    permitMs: positiveNumber(env, "EASEL_PASEO_PERMIT_MS", 3000),
  };
}
