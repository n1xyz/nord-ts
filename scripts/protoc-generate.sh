#!/usr/bin/env bash

# Root directory of app
ROOT_DIR=$(git rev-parse --show-toplevel)

# Path to Protoc Plugin
TS_PROTO_PATH="${ROOT_DIR}/ts/node_modules/.bin/protoc-gen-ts"

# Directory holding all .proto files
SRC_DIR="${ROOT_DIR}/engine"

# Directory to write generated code (.d.ts files)
OUT_DIR="${ROOT_DIR}/ts/src/gen"

# Clean all existing generated files
rm -r "${OUT_DIR}"
mkdir "${OUT_DIR}"

# Generate all messages
protoc \
    --plugin="protoc-gen-ts=${TS_PROTO_PATH}" \
    --ts_opt=esModuleInterop=true \
    --ts_opt=forceLong=bigint \
    --js_out="import_style=commonjs,binary:${OUT_DIR}" \
    --ts_out="${OUT_DIR}" \
    --proto_path="${SRC_DIR}" \
    $(find "${SRC_DIR}" -iname "*.proto")

