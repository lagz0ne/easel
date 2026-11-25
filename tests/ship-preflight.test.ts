import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, expect, test } from "vite-plus/test";

const shipScript = new URL("../scripts/ship.sh", import.meta.url).pathname;
const bunDir = dirname(Bun.which("bun") ?? process.execPath);
const root = mkdtempSync(join(tmpdir(), "ship-preflight-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let made = 0;

type Scripts = { "check:style": string; typecheck: string };

const greenScripts: Scripts = { "check:style": "true", typecheck: "true" };

function git(cwd: string, ...args: string[]) {
  const done = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, HOME: cwd } });
  if (done.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${done.stderr.toString()}`);

  return done.stdout.toString().trim();
}

function writeExecutable(path: string, text: string) {
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

function makeRepo(scripts: Scripts = greenScripts) {
  made += 1;
  const dir = join(root, `repo-${made}`);
  const work = join(dir, "work");
  const origin = join(dir, "origin.git");
  const stubs = join(dir, "stubs");
  for (const path of [work, stubs, join(work, "scripts"), join(work, "src"), join(dir, "home")]) {
    mkdirSync(path, { recursive: true });
  }
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  git(work, "init", "-q", "-b", "main");
  git(work, "config", "user.name", "ship test");
  git(work, "config", "user.email", "ship@test.invalid");
  writeFileSync(join(work, "package.json"), JSON.stringify({ name: "t", private: true, scripts }));
  writeFileSync(join(work, ".gitignore"), "node_modules/\n.ship/\n");
  writeFileSync(join(work, "scripts", "ship.sh"), readFileSync(shipScript));
  writeFileSync(join(work, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(work, "src", "shared.ts"), "export const shared = 1;\n");
  writeFileSync(join(work, "src", "old.ts"), "export const old = 1;\n");
  writeFileSync(join(work, "README.md"), "# t\n");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "start");
  git(work, "remote", "add", "origin", origin);
  git(work, "push", "-q", "origin", "main");
  writeExecutable(join(stubs, "gh"), "#!/bin/sh\nexit 0\n");
  writeExecutable(
    join(stubs, "format"),
    `#!/bin/sh\necho "$*" >> ${join(dir, "formatted")}\nfor f in "$@"; do echo "// formatted" >> "$f"; done\n`,
  );
  const loadavg = join(dir, "loadavg");
  writeFileSync(loadavg, "0.50 0.40 0.30 1/100 42\n");

  return { dir, work, origin, stubs, loadavg, runs: join(dir, "runs") };
}

type Repo = ReturnType<typeof makeRepo>;

function envOf(repo: Repo, more: Record<string, string> = {}) {
  return {
    HOME: join(repo.dir, "home"),
    PATH: `${repo.stubs}:${bunDir}:/usr/bin:/bin`,
    SHIP_RUNS: repo.runs,
    SHIP_LOADAVG_FILE: repo.loadavg,
    SHIP_FORMAT: join(repo.stubs, "format"),
    PASEO_AGENT_ID: "agent-7",
    ...more,
  };
}

function ship(repo: Repo, args: string[], more: Record<string, string> = {}) {
  const done = Bun.spawnSync(["bash", "scripts/ship.sh", ...args], {
    cwd: repo.work,
    env: envOf(repo, more),
  });

  return { code: done.exitCode, err: done.stderr.toString() };
}

function runsOf(repo: Repo): unknown[] {
  const text = readFileSync(join(repo.runs, "runs.jsonl"), "utf8");

  return text
    .trim()
    .split("\n")
    .map((line): unknown => JSON.parse(line));
}

const originHead = (repo: Repo) => git(repo.origin, "rev-parse", "main");

test("a load of 12 with no wait refuses the ship, commits nothing, and records the result load", () => {
  const repo = makeRepo();
  const before = originHead(repo);
  writeFileSync(repo.loadavg, "12.00 9.00 8.00 3/400 77\n");
  writeFileSync(join(repo.work, "src", "a.ts"), "export const a = 2;\n");

  const done = ship(repo, ["-m", "feat(a): two", "--", "src/a.ts"], { SHIP_LOAD_WAIT_S: "0" });

  expect(done.code).toBe(1);
  expect(done.err).toContain("load stays at 12.00; nothing shipped. Run it again later.");
  expect(originHead(repo)).toBe(before);
  expect(git(repo.work, "rev-parse", "HEAD")).toBe(before);
  expect(runsOf(repo)).toEqual([
    {
      at: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/),
      agent: "agent-7",
      mode: "ship",
      docs: false,
      tree: null,
      stage: null,
      result: "load",
      seconds: 0,
      load: 12,
      paths: 1,
    },
  ]);
});

test("a load above the maximum waits, logs one time, and ships when the load falls", async () => {
  const repo = makeRepo();
  writeFileSync(repo.loadavg, "11.00 9.00 8.00 3/400 77\n");
  writeFileSync(join(repo.work, "src", "a.ts"), "export const a = 3;\n");
  const child = Bun.spawn(["bash", "scripts/ship.sh", "-m", "feat(a): three", "--", "src/a.ts"], {
    cwd: repo.work,
    env: envOf(repo, { SHIP_LOAD_POLL_S: "1", SHIP_LOAD_WAIT_S: "20" }),
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  let err = "";
  for await (const chunk of child.stderr) {
    err += decoder.decode(chunk);
    if (err.includes("waiting for a load below")) {
      writeFileSync(repo.loadavg, "2.00 9.00 8.00 3/400 77\n");
    }
  }

  expect(await child.exited).toBe(0);
  expect(err.match(/load 11\.00: waiting for a load below 10/g)).toHaveLength(1);
  expect(runsOf(repo)).toEqual([expect.objectContaining({ result: "green", load: 11 })]);
});

test("a green code ship records the result green with its tree, and formats only the named paths", () => {
  const repo = makeRepo();
  writeFileSync(join(repo.work, "src", "a.ts"), "export const a = 4;\n");
  writeFileSync(join(repo.work, "src", "shared.ts"), "export const shared = 2;\n");
  const patch = join(repo.dir, "shared.patch");
  writeFileSync(patch, git(repo.work, "diff", "--", "src/shared.ts") + "\n");
  rmSync(join(repo.work, "src", "old.ts"));

  const done = ship(repo, ["-m", "feat(a): four", "-p", patch, "--", "src/a.ts", "src/old.ts"]);

  expect(done.code).toBe(0);
  expect(done.err).toContain("formatted: src/a.ts");
  expect(readFileSync(join(repo.dir, "formatted"), "utf8")).toBe("src/a.ts\n");
  expect(git(repo.origin, "show", "main:src/a.ts")).toBe("export const a = 4;\n// formatted");
  expect(git(repo.origin, "show", "main:src/shared.ts")).toBe("export const shared = 2;");
  expect(git(repo.origin, "ls-tree", "--name-only", "main", "src/")).toBe(
    "src/a.ts\nsrc/shared.ts",
  );
  expect(runsOf(repo)).toEqual([
    expect.objectContaining({
      agent: "agent-7",
      mode: "ship",
      docs: false,
      tree: expect.stringMatching(/^[0-9a-f]{7}$/),
      stage: null,
      result: "green",
      seconds: expect.any(Number),
      load: 0.5,
      paths: 3,
    }),
  ]);
});

test("a red typecheck records the result red at the stage typecheck, and commits nothing", () => {
  const repo = makeRepo({ "check:style": "true", typecheck: "exit 1" });
  const before = originHead(repo);
  writeFileSync(join(repo.work, "src", "a.ts"), "export const a = 5;\n");

  const done = ship(repo, ["-m", "feat(a): five", "--", "src/a.ts"], { PASEO_AGENT_ID: "" });

  expect(done.code).toBe(1);
  expect(done.err).toContain("RED at typecheck");
  expect(originHead(repo)).toBe(before);
  expect(runsOf(repo)).toEqual([
    expect.objectContaining({ agent: null, result: "red", stage: "typecheck", docs: false }),
  ]);
});

test("a docs ship is green with docs true, and a second ship of the same paths records the result empty", () => {
  const repo = makeRepo({ "check:style": "true", typecheck: "exit 1" });
  writeFileSync(join(repo.work, "README.md"), "# t\n\nmore\n");

  const formatsNothing = { SHIP_FORMAT: "true" };

  expect(ship(repo, ["-m", "docs: more", "--", "README.md"], formatsNothing).code).toBe(0);
  const again = ship(repo, ["-m", "docs: more", "--", "README.md"], formatsNothing);

  expect(again.code).toBe(1);
  expect(again.err).toContain("nothing to ship");
  expect(runsOf(repo)).toEqual([
    expect.objectContaining({ result: "green", docs: true, stage: null }),
    expect.objectContaining({ result: "empty", docs: true, stage: null, tree: expect.any(String) }),
  ]);
});

test("the record has no message text and no path", () => {
  const repo = makeRepo();
  writeFileSync(join(repo.work, "src", "a.ts"), "export const a = 6;\n");

  ship(repo, ["-m", "feat(a): secret words", "--", "src/a.ts"]);

  const text = readFileSync(join(repo.runs, "runs.jsonl"), "utf8");
  expect(text).not.toContain("secret words");
  expect(text).not.toContain("src/a.ts");
});
