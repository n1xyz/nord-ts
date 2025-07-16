{ inputs, ... }:
{
  perSystem =
    {
      pkgs,
      self',
      system,
      ...
    }:
    {
      packages = {
        nord-ts-proto =
          let
            ts-proto = inputs.n1.packages.${system}.ts-proto;
          in
          pkgs.writeShellApplication {
            name = "nord-ts-proto";
            runtimeInputs = [ pkgs.protobuf ];
            text = ''
              if [ $# -ne 2 ]; then
                echo >&2 "usage: $(basename "$0") <proto-file> <out-dir>"
                exit 1
              fi
              readonly PROTO_FILE="$1"
              readonly OUT_DIR="$2"
              protoc \
                --plugin="${ts-proto}/bin/protoc-gen-ts_proto" \
                --ts_proto_opt=forceLong=bigint \
                --ts_proto_opt=esModuleInterop=true \
                --ts_proto_opt=oneof=unions-value \
                --ts_proto_opt=unrecognizedEnum=false \
                --ts_proto_out="$OUT_DIR" \
                --proto_path="$(dirname "$PROTO_FILE")" \
                "$PROTO_FILE"
            '';
          };
        nord-ts-check = pkgs.writeShellApplication {
          name = "ts-check";
          runtimeInputs = [
            pkgs.protobuf
            pkgs.pnpm
          ];
          text = builtins.readFile ./check.sh;
        };
      };
    };
}
