#!/usr/bin/env bash
set -euo pipefail

PATH="$PWD/bin:$PATH"

printf '\n[smoke] syntax check\n'
bash -n bin/cc

printf '\n[smoke] help output\n'
cc --help >/tmp/cc-help.txt
rg "cc - AI/Git terminal helper" /tmp/cc-help.txt >/dev/null

printf '\n[smoke] doctor output\n'
cc doctor >/tmp/cc-doctor.txt || true
rg "Repository:" /tmp/cc-doctor.txt >/dev/null

printf '\n[smoke] review command\n'
cc review >/tmp/cc-review.txt || true

printf '\n[smoke] invalid commit type should fail\n'
if cc commit invalid "msg" >/tmp/cc-invalid.txt 2>&1; then
  echo "expected commit with invalid type to fail"
  exit 1
fi

printf '\n[smoke] passed\n'
