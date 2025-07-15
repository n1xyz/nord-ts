#!/bin/sh
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
SCRIPT_DIR="${1:-$SCRIPT_DIR}"
PROTO_PATH="${SCRIPT_DIR}/../engine/nord.proto"
PROTO_INCLUE_PATH="${SCRIPT_DIR}/.."
PLUGIN_PATH="${SCRIPT_DIR}/../../node_modules/.bin/protoc-gen-ts_proto"
OUT_DIR="${SCRIPT_DIR}/src/gen"

protoc \
    --plugin="${PLUGIN_PATH}" \
    --ts_proto_opt=forceLong=bigint \
    --ts_proto_opt=esModuleInterop=true \
    --ts_proto_opt=oneof=unions-value \
    --ts_proto_opt=unrecognizedEnum=false \
    --ts_proto_out="${OUT_DIR}" \
    --proto_path="$(dirname "${PROTO_PATH}")" \
    --proto_path="${PROTO_INCLUE_PATH}" \
    "${PROTO_PATH}"
