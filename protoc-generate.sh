#!/bin/sh

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PROTO_PATH="${SCRIPT_DIR}/../engine/nord.proto"
PLUGIN_PATH="${SCRIPT_DIR}/node_modules/.bin/protoc-gen-ts_proto"
OUT_DIR="${SCRIPT_DIR}/src/gen"

# Clean all existing generated files
rm -rf "${OUT_DIR}"
mkdir "${OUT_DIR}"

# Generate all messages
protoc \
    --plugin="${PLUGIN_PATH}" \
    --ts_proto_opt=forceLong=bigint \
    --ts_proto_opt=esModuleInterop=true \
    --ts_proto_opt=oneof=unions-value \
    --ts_proto_opt=unrecognizedEnum=false \
    --ts_proto_out="${OUT_DIR}" \
    --proto_path="$(dirname "${PROTO_PATH}")" \
    "${PROTO_PATH}"
