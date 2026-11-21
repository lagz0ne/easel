#!/usr/bin/env bash
# Get the Java and the TLC that the statechart generator needs, at pinned versions and SHA-256.
#
#   scripts/tlc.sh            print `TLA2TOOLS=<jar>` and `JAVA=<java>`, one on each line
#
# The first run downloads Eclipse Temurin JRE (Adoptium) and tla2tools.jar (the TLA+ tools) into
# ${XDG_CACHE_HOME:-~/.cache}/easel/tlc/, and checks each SHA-256 before it uses the file. No
# root. Later runs only print. To upgrade, change a version and its SHA-256 here.
set -euo pipefail

JRE_V=25.0.5+8
JRE_SHA=6fac98f0c8202efc3135a9e9e42aa61963ec42d1c5cbb40caf231e7b14a24ef6
TLA_V=1.7.4
TLA_SHA=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88

cache="${XDG_CACHE_HOME:-$HOME/.cache}/easel/tlc"
jre="$cache/jre-$JRE_V"
jar="$cache/tla2tools-$TLA_V.jar"

get() { # <url> <sha256> <out>
  local part="$3.part"
  curl -fsSL --retry 2 -o "$part" "$1"
  if ! echo "$2  $part" | sha256sum -c --strict - >/dev/null; then
    rm -f "$part"
    echo "tlc: the SHA-256 of $1 is not $2" >&2
    exit 1
  fi
  mv "$part" "$3"
}

mkdir -p "$cache"
if [[ ! -x "$jre/bin/java" ]]; then
  echo "tlc: getting Temurin JRE $JRE_V (once)" >&2
  url="https://github.com/adoptium/temurin25-binaries/releases/download/jdk-${JRE_V/+/%2B}/OpenJDK25U-jre_x64_linux_hotspot_${JRE_V/+/_}.tar.gz"
  get "$url" "$JRE_SHA" "$cache/jre.tgz"
  rm -rf "$cache/jre.tmp" "$jre"
  mkdir -p "$cache/jre.tmp"
  tar -xzf "$cache/jre.tgz" -C "$cache/jre.tmp"
  mv "$cache/jre.tmp"/jdk-* "$jre"
  rm -rf "$cache/jre.tmp" "$cache/jre.tgz"
fi
if ! echo "$TLA_SHA  $jar" | sha256sum -c --strict - >/dev/null 2>&1; then
  echo "tlc: getting tla2tools.jar $TLA_V (once)" >&2
  get "https://github.com/tlaplus/tlaplus/releases/download/v$TLA_V/tla2tools.jar" "$TLA_SHA" "$jar"
fi

echo "TLA2TOOLS=$jar"
echo "JAVA=$jre/bin/java"
