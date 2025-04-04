#!/bin/sh
cd "$(dirname "$0")"
set -x
nix run ..#print-idl > ./src/idl/bridge.json
