import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exits } from "@tinkered/cli/test";
import { createScope, transport } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";

import { release } from "@/release";

type Cmd = typeof import("../cmds/server");

const root = new URL("..", import.meta.url).pathname;

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const binaries = Object.fromEntries(
  ["darwin-arm64", "linux-x64", "linux-arm64"].map((target) => [
    `easel-${target}`,
    `#!/bin/sh\necho "easel ${target} $*"\n`,
  ]),
);

const sumOf = (text: string) => createHash("sha256").update(text).digest("hex");

function fakeRelease(sums = binaries) {
  const asked: string[] = [];
  const files: Record<string, string> = {
    ...binaries,
    SHA256SUMS: Object.entries(sums)
      .map(([name, text]) => `${sumOf(text)}  ${name}\n`)
      .join(""),
  };
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const path = new URL(req.url).pathname;
      asked.push(path);
      const name = path.replace(/^\/build-412\//, "");
      const file = path.startsWith("/build-412/") ? files[name] : undefined;
      return file === undefined ? new Response("Not Found", { status: 404 }) : new Response(file);
    },
  });
  closers.push(() => server.stop(true));

  return { url: `http://127.0.0.1:${server.port}`, asked, files };
}

async function scriptOf(downloads: string, build = 412) {
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      release({ commit: "523889a", build, origin: "https://acme.easel.test", downloads }),
    ],
  }).ready;
  const asked = new Request("http://10.0.0.5:3000/install.sh");
  const reply = await scope.run(release.install, { tags: [transport.request(asked)] });
  await scope.close();

  return { type: reply.headers.get("content-type"), text: await reply.text() };
}

const shells = [["sh"], ["dash"], ["busybox", "sh"]].filter(([bin]) => Bun.which(bin ?? ""));

function machine(os: string, arch: string, rosetta = "0") {
  const home = mkdtempSync(join(tmpdir(), "easel-install-"));
  closers.push(() => rmSync(home, { recursive: true, force: true }));
  const fake = join(home, "fake-bin");
  mkdirSync(fake);
  writeFileSync(
    join(fake, "uname"),
    `#!/bin/sh\ncase "$1" in -s) echo ${os} ;; -m) echo ${arch} ;; *) echo ${os} ;; esac\n`,
  );
  writeFileSync(join(fake, "sysctl"), `#!/bin/sh\necho ${rosetta}\n`);
  chmodSync(join(fake, "uname"), 0o755);
  chmodSync(join(fake, "sysctl"), 0o755);

  return { home, path: `${fake}:/usr/local/bin:/usr/bin:/bin` };
}

async function pipe(shell: string[], script: string, at: ReturnType<typeof machine>, env = {}) {
  const child = Bun.spawn(shell, {
    stdin: new Blob([script]),
    stdout: "pipe",
    stderr: "pipe",
    env: { HOME: at.home, PATH: at.path, TMPDIR: at.home, ...env },
  });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  return { code, out, err };
}

test("the script holds the address and the build of this easel, as a shell script", async () => {
  const got = await scriptOf("https://github.com/lagz0ne/easel/releases/download/");

  expect(got.type).toBe("text/x-shellscript; charset=utf-8");
  expect(got.text).toMatch(/^#!\/bin\/sh\n/);
  expect(got.text).toContain("server='https://acme.easel.test'\n");
  expect(got.text).toContain("build='412'\n");
  expect(got.text).toContain(
    "release='https://github.com/lagz0ne/easel/releases/download/build-412'\n",
  );
  expect(got.text.trimEnd().split("\n").at(-1)).toBe('main "$@"');
});

test.each(shells)(
  "%s: linux-x64 and linux-arm64 install into ~/.local/bin, darwin-arm64 into $EASEL_BIN_DIR, each its own binary, then the next step",
  async (...shell) => {
    const fake = fakeRelease();
    const { text } = await scriptOf(fake.url);

    const linux = machine("Linux", "x86_64");
    const run = await pipe(shell, text, linux);
    expect(run.code).toBe(0);
    expect(run.err).not.toContain("easel install:");
    expect(run.out).toContain(`easel build 412 (linux-x64) is in ${linux.home}/.local/bin/easel`);
    expect(run.out).toContain("Add it to your PATH");
    expect(run.out.trimEnd().split("\n").at(-1)).toBe(
      "Next: easel login https://acme.easel.test --name <name>",
    );
    const installed = join(linux.home, ".local", "bin", "easel");
    expect(readFileSync(installed, "utf8")).toBe(binaries["easel-linux-x64"]);
    expect(Bun.spawnSync([installed, "--help"]).stdout.toString()).toBe("easel linux-x64 --help\n");

    const arm = machine("Linux", "aarch64");
    expect((await pipe(shell, text, arm)).code).toBe(0);
    expect(readFileSync(join(arm.home, ".local", "bin", "easel"), "utf8")).toBe(
      binaries["easel-linux-arm64"],
    );

    const mac = machine("Darwin", "arm64");
    const dir = join(mac.home, "tools");
    const onMac = await pipe(shell, text, mac, { EASEL_BIN_DIR: dir });
    expect(onMac.code).toBe(0);
    expect(readFileSync(join(dir, "easel"), "utf8")).toBe(binaries["easel-darwin-arm64"]);
    expect(existsSync(join(mac.home, ".local"))).toBe(false);

    const rosetta = machine("Darwin", "x86_64", "1");
    expect((await pipe(shell, text, rosetta)).code).toBe(0);
    expect(readFileSync(join(rosetta.home, ".local", "bin", "easel"), "utf8")).toBe(
      binaries["easel-darwin-arm64"],
    );
    expect(fake.asked).toContain("/build-412/SHA256SUMS");
  },
);

test.each(shells)(
  "%s: another system installs nothing, downloads nothing, and says why",
  async (...shell) => {
    const fake = fakeRelease();
    const { text } = await scriptOf(fake.url);

    for (const [os, arch] of [
      ["Darwin", "x86_64"],
      ["MINGW64_NT-10.0", "x86_64"],
      ["Linux", "riscv64"],
    ] as const) {
      const at = machine(os, arch);
      const run = await pipe(shell, text, at);
      expect(run.code).toBe(1);
      expect(run.err).toMatch(
        /^easel install: there is no easel for \S+: easel runs on darwin-arm64, linux-x64 and linux-arm64\. Nothing is installed\.\n$/,
      );
      expect(existsSync(join(at.home, ".local"))).toBe(false);
    }
    expect(fake.asked).toEqual([]);
  },
);

test.each(shells)(
  "%s: a wrong sum, a sum that is not there, or a failed download installs nothing; the old easel stays",
  async (...shell) => {
    const wrong = fakeRelease({ ...binaries, "easel-linux-x64": "something else" });
    const at = machine("Linux", "x86_64");
    const bin = join(at.home, ".local", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "easel"), "the old easel");

    const bad = await pipe(shell, (await scriptOf(wrong.url)).text, at);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain(
      `the SHA-256 of easel-linux-x64 is ${sumOf(binaries["easel-linux-x64"] ?? "")}, but SHA256SUMS says ${sumOf("something else")}. Nothing is installed.`,
    );

    const { "easel-linux-x64": _gone, ...others } = binaries;
    const missing = fakeRelease(others);
    const none = await pipe(shell, (await scriptOf(missing.url)).text, at);
    expect(none.code).toBe(1);
    expect(none.err).toContain("the SHA256SUMS of build 412 has no easel-linux-x64.");

    const fake = fakeRelease();
    const notThere = await pipe(shell, (await scriptOf(fake.url, 413)).text, at);
    expect(notThere.code).toBe(1);
    expect(notThere.err).toContain(
      `cannot download ${fake.url}/build-413/SHA256SUMS. Nothing is installed.`,
    );

    expect(readFileSync(join(bin, "easel"), "utf8")).toBe("the old easel");
    expect(Bun.spawnSync(["ls", "-A", bin]).stdout.toString()).toBe("easel\n");
  },
);

test.each(shells)(
  "%s: an easel that runs from source (build 0) has no release",
  async (...shell) => {
    const fake = fakeRelease();
    const at = machine("Linux", "x86_64");

    const run = await pipe(shell, (await scriptOf(fake.url, 0)).text, at);
    expect(run).toMatchObject({
      code: 1,
      err: "easel install: https://acme.easel.test runs from source (build 0): it has no release to install\n",
    });
    expect(fake.asked).toEqual([]);
  },
);

test("GET /install.sh on the real server: no sign-in, the script of its build, with the address it was asked at", async () => {
  const server: Cmd = await import(new URL("../cmds/server.ts", import.meta.url).href);
  const collector = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 204 }) });
  closers.push(() => collector.stop(true));
  const stop = new AbortController();
  const app = await server.default({
    env: {
      PORT: "0",
      PUBLIC_ORIGIN: "",
      BUILD: "7",
      EASEL_DB: ":memory:",
      OTEL_SERVICE_NAME: "install-test",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}traces`,
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${collector.url}logs`,
    },
    args: [],
    cwd: root,
    signal: stop.signal,
    stdout: { write: () => undefined },
    stderr: { write: () => undefined },
    exit: (code, reason) => stop.abort(reason ?? code),
  });
  if (!("resolve" in app)) throw new Error("the server did not start");
  closers.push(async () => (stop.abort(), await app.closed));
  const { serve: port } = await import("@tinkered/bun");
  const url = app.resolve(port.url).get() ?? new URL("http://localhost:0");

  const reply = await fetch(`http://localhost:${url.port}/install.sh`);
  expect(reply.status).toBe(200);
  expect(reply.headers.get("content-type")).toBe("text/x-shellscript; charset=utf-8");
  const text = await reply.text();
  expect(text).toContain(`server='http://localhost:${url.port}'\n`);
  expect(text).toContain("build='7'\n");
  expect(text).toContain("release='https://github.com/lagz0ne/easel/releases/download/build-7'\n");
});
