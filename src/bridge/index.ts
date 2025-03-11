export * from "./client";
export * from "./types";
export * from "./utils";

// Re-export the IDL for convenience
import { BRIDGE_IDL } from "../idl/bridge";
export { BRIDGE_IDL };
