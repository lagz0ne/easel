import { capsule, operation, tag, transport } from "@tinkered/core";
import { z } from "zod";

const commit = tag<string>({ label: "release.commit", parse: z.string().min(1) });

const build = tag<number>({
  label: "release.build",
  default: 0,
  parse: z.number().int().nonnegative(),
});

const origin = tag<string | null>({ label: "release.origin", default: null });

export const releaseClient = tag<string | null>({ label: "release.client", default: null });

const downloads = tag<string>({
  label: "release.downloads",
  default: "https://github.com/lagz0ne/easel/releases/download",
  parse: z.url({ protocol: /^https?$/ }),
});

const version = operation({
  label: "release.version",
  depends: { commit, build, client: releaseClient },
  run: ({ commit, build, client }) => ({ commit, build, client }),
});

const script = `#!/bin/sh
# Installs the easel command line of @SERVER@, build @BUILD@ (SPEC-cli.md, "Get the command line"):
#   curl -fsSL @SERVER@/install.sh | sh
# It puts the binary in ~/.local/bin/easel, or in $EASEL_BIN_DIR. It installs only a binary whose
# SHA-256 is the one in the SHA256SUMS of the build.
set -eu

server='@SERVER@'
build='@BUILD@'
release='@RELEASE@'

fail() {
  printf 'easel install: %s\\n' "$1" >&2
  exit 1
}

main() {
  bin_dir="\${EASEL_BIN_DIR:-$HOME/.local/bin}"
  [ "$build" != 0 ] || fail "$server runs from source (build 0): it has no release to install"

  os=$(uname -s)
  arch=$(uname -m)
  case "$os" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
  esac
  case "$arch" in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
  esac
  # A shell under Rosetta on an Apple chip says x86_64: the arm64 binary is the right one.
  if [ "$os-$arch" = darwin-x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
    arch=arm64
  fi
  target="$os-$arch"
  case "$target" in
    darwin-arm64 | linux-x64 | linux-arm64) ;;
    *) fail "there is no easel for $target: easel runs on darwin-arm64, linux-x64 and linux-arm64. Nothing is installed." ;;
  esac

  command -v curl >/dev/null 2>&1 || fail "curl is needed. Nothing is installed."
  if command -v sha256sum >/dev/null 2>&1; then
    hash='sha256sum'
  elif command -v shasum >/dev/null 2>&1; then
    hash='shasum -a 256'
  else
    fail "sha256sum or shasum is needed to check the download. Nothing is installed."
  fi

  tmp=$(mktemp -d "\${TMPDIR:-/tmp}/easel-install.XXXXXX")
  trap 'rm -rf "$tmp"' EXIT
  asset="easel-$target"
  curl -fsSL --retry 2 -o "$tmp/SHA256SUMS" "$release/SHA256SUMS" ||
    fail "cannot download $release/SHA256SUMS. Nothing is installed."
  curl -fSL --retry 2 --progress-bar -o "$tmp/$asset" "$release/$asset" ||
    fail "cannot download $release/$asset. Nothing is installed."

  want=$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1 }' "$tmp/SHA256SUMS")
  [ -n "$want" ] || fail "the SHA256SUMS of build $build has no $asset. Nothing is installed."
  got=$($hash "$tmp/$asset" | awk '{ print $1 }')
  [ "$got" = "$want" ] ||
    fail "the SHA-256 of $asset is $got, but SHA256SUMS says $want. Nothing is installed."

  mkdir -p "$bin_dir" || fail "cannot make $bin_dir. Nothing is installed."
  chmod 755 "$tmp/$asset"
  # Copy beside the old one, then rename: the old easel stays whole until the new one is there.
  cp "$tmp/$asset" "$bin_dir/.easel.$$" || fail "cannot write to $bin_dir. Nothing is installed."
  mv -f "$bin_dir/.easel.$$" "$bin_dir/easel"

  printf 'easel build %s (%s) is in %s/easel\\n' "$build" "$target" "$bin_dir"
  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *) printf 'Add it to your PATH: export PATH="%s:$PATH"\\n' "$bin_dir" ;;
  esac
  printf 'Next: easel login %s --name <name>\\n' "$server"
}

main "$@"
`;

const install = operation({
  label: "release.install",
  depends: { build, origin, downloads, request: transport.request.required },
  run: ({ build, origin, downloads, request }) => {
    const server = origin ?? new URL(request.url).origin;
    const release = `${downloads.replace(/\/+$/, "")}/build-${build}`;
    const text = script
      .replaceAll("@SERVER@", server)
      .replaceAll("@BUILD@", `${build}`)
      .replaceAll("@RELEASE@", release.replaceAll("'", "%27"));

    return new Response(text, {
      headers: { "content-type": "text/x-shellscript; charset=utf-8", "cache-control": "no-cache" },
    });
  },
});

export const release = capsule({
  label: "release",
  config: { commit: commit.required, build, origin, downloads, client: releaseClient },
  exports: { version, install },
});
