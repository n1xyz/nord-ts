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
        ts-check = pkgs.writeShellApplication {
          name = "ts-check";
          runtimeInputs = [
            pkgs.protobuf
            pkgs.pnpm
          ];
          text = "bun run all";
        };
      };
    };
}
