#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: scripts/build-linux-mount.sh <x86_64-unknown-linux-musl|aarch64-unknown-linux-musl>" >&2
  exit 2
fi

target="$1"
case "$target" in
  x86_64-unknown-linux-musl) package_arch=linux-x64 ;;
  aarch64-unknown-linux-musl) package_arch=linux-arm64 ;;
  *) echo "unsupported mount helper target: $target" >&2; exit 2 ;;
esac

build_rustflags="${RUSTFLAGS:+$RUSTFLAGS }-C target-feature=+crt-static -C link-arg=-static"
RUSTFLAGS="$build_rustflags" cargo +1.87.0 build --locked --release --manifest-path native/mount/Cargo.toml --target "$target"
output="packages/agent-drive/native/$package_arch"
mkdir -p "$output"
install -m 0755 "native/mount/target/$target/release/agent-drive-mount" "$output/agent-drive-mount"
