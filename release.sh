#!/usr/bin/env bash
# Terminal Engine — native installer builder.
#
# Produces a single-file installable bundle of the Tauri desktop app.
# No Docker, no daemon, no frontend server — users double-click the artifact.
#
# Usage:
#   ./release.sh            Build for the current host platform.
#   ./release.sh --targets  Print which bundle targets will be produced.
#   ./release.sh --clean    Remove ./release/ before building.
#
# Host requirements:
#   Linux:   rustc 1.88+, Node.js 20+, libwebkit2gtk-4.1-dev, libgtk-3-dev,
#            libayatana-appindicator3-dev, librsvg2-dev, build-essential
#   macOS:   Xcode Command Line Tools, Node.js 20+
#   Windows: MSVC Build Tools, WebView2 runtime, Node.js 20+
#
# Cross-compilation is not supported from a single host — to ship Windows + macOS
# builds, run this script on a matching runner (e.g. GitHub Actions matrix).

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
cd "$SCRIPT_DIR"

# --- styling -----------------------------------------------------------------
if [[ -t 1 ]]; then
  C_RESET=$'\e[0m'; C_BOLD=$'\e[1m'; C_RED=$'\e[31m'
  C_GREEN=$'\e[32m'; C_YELLOW=$'\e[33m'; C_BLUE=$'\e[34m'; C_DIM=$'\e[2m'
else
  C_RESET=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_DIM=''
fi
log()  { printf '%s==>%s %s\n' "$C_BLUE$C_BOLD" "$C_RESET" "$*"; }
ok()   { printf '%s ✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$C_YELLOW$C_BOLD" "$C_RESET" "$*"; }
die()  { printf '%s✗%s %s\n' "$C_RED$C_BOLD" "$C_RESET" "$*" >&2; exit 1; }

# --- detect host -------------------------------------------------------------
HOST_OS="$(uname -s)"
HOST_ARCH="$(uname -m)"
case "$HOST_OS" in
  Linux)   HOST_LABEL="linux-${HOST_ARCH}";   EXPECTED_BUNDLES=("deb" "appimage") ;;
  Darwin)  HOST_LABEL="macos-${HOST_ARCH}";   EXPECTED_BUNDLES=("dmg" "macos")    ;;
  MINGW*|MSYS*|CYGWIN*) HOST_LABEL="windows-${HOST_ARCH}"; EXPECTED_BUNDLES=("msi" "nsis") ;;
  *) die "Unsupported host OS: $HOST_OS" ;;
esac

VERSION="$(awk -F\" '/^version *=/ {print $2; exit}' Cargo.toml)"
[[ -n "${VERSION:-}" ]] || die "Could not read version from Cargo.toml"

# --- early exits -------------------------------------------------------------
case "${1:-}" in
  --targets)
    printf 'Host: %s\n' "$HOST_LABEL"
    printf 'Version: %s\n' "$VERSION"
    printf 'Bundle targets: %s\n' "${EXPECTED_BUNDLES[*]}"
    exit 0
    ;;
  --clean)
    log "Removing ./release/ ..."
    rm -rf ./release
    ;;
  help|-h|--help)
    sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  '') : ;;
  *) die "Unknown flag: $1 (try './release.sh --help')" ;;
esac

# --- preflight ---------------------------------------------------------------
command -v cargo >/dev/null 2>&1 || die "Rust toolchain not found. Install via https://rustup.rs/"
command -v node  >/dev/null 2>&1 || die "Node.js not found. Install Node 20+."
command -v npm   >/dev/null 2>&1 || die "npm not found (ships with Node)."

RUSTC_VER="$(rustc --version | awk '{print $2}')"
log "Host: $HOST_LABEL  |  rustc: $RUSTC_VER  |  node: $(node -v)"

# Ensure tauri-cli is available (cargo subcommand).
if ! cargo tauri --version >/dev/null 2>&1; then
  warn "cargo-tauri not installed — installing tauri-cli (one-time, ~2 min)..."
  cargo install tauri-cli --version '^2' --locked
fi

# --- frontend deps (tauri runs npm run build via beforeBuildCommand) --------
if [[ ! -d frontend/node_modules ]]; then
  log "Installing frontend dependencies (first build only)..."
  (cd frontend && npm ci)
fi

# --- build -------------------------------------------------------------------
log "Building release bundles with cargo tauri build ..."
log "This compiles the Rust workspace in --release and runs vite build. First run ~10 min."
cargo tauri build

# --- collect artifacts -------------------------------------------------------
OUT_DIR="release/${HOST_LABEL}-v${VERSION}"
mkdir -p "$OUT_DIR"
BUNDLE_ROOT="target/release/bundle"
[[ -d "$BUNDLE_ROOT" ]] || die "Expected bundle dir not found at $BUNDLE_ROOT"

shopt -s nullglob
collected=0
for target in "${EXPECTED_BUNDLES[@]}"; do
  for file in "$BUNDLE_ROOT/$target"/*.{deb,AppImage,dmg,msi,exe,app}; do
    cp -v "$file" "$OUT_DIR/" && collected=$((collected+1))
  done
done
shopt -u nullglob

(( collected > 0 )) || die "No bundle artifacts were produced. Check tauri.conf.json bundle.targets."

ok "Built $collected artifact(s):"
ls -lh "$OUT_DIR" | tail -n +2 | awk '{printf "    %s  %s\n", $5, $9}'
printf '\n%sDistribute from:%s %s%s%s\n' \
  "$C_DIM" "$C_RESET" "$C_BOLD" "$OUT_DIR" "$C_RESET"
printf '%sEnd user:%s download → double-click → app launches. No terminal, no Docker.\n' \
  "$C_DIM" "$C_RESET"
