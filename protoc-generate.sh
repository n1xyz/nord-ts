#!/bin/sh

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PROTO_PATH="${SCRIPT_DIR}/nord.proto"
PLUGIN_PATH="${SCRIPT_DIR}/node_modules/.bin/protoc-gen-ts"
OUT_DIR="${SCRIPT_DIR}/src/gen"

# Clean all existing generated files
rm -rf "${OUT_DIR}"
mkdir "${OUT_DIR}"

# Generate all messages
protoc \
    --plugin="protoc-gen-ts=${PLUGIN_PATH}" \
    --ts_opt=esModuleInterop=true \
    --ts_opt=forceLong=bigint \
    --js_out="import_style=commonjs,binary:${OUT_DIR}" \
    --ts_out="${OUT_DIR}" \
    --proto_path="$(dirname "${PROTO_PATH}")" \
    "${PROTO_PATH}"
