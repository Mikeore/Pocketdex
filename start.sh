#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
  printf '\nPocketDex needs Node.js 18 or newer.\n'
  printf 'Install it from https://nodejs.org and run ./start.sh again.\n\n'
  exit 1
fi

exec node scripts/bootstrap.js
