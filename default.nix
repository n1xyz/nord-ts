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
