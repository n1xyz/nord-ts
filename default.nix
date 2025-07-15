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
        # Generates TypeScript types from Rust code
        nord-ts-gen = pkgs.writeShellApplication {
          name = "ts-gen";
          runtimeInputs = [ pkgs.protobuf ];
          text = builtins.readFile ./protoc-generate.sh;
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
