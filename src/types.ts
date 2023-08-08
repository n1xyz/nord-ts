import { Decimal } from "decimal.js";
import * as proto from "./gen/action";

export type ActionKind =
  | (proto.Action_CreateUser & { tag: ActionKindTag.CreateUser })
  | (proto.Action_CreateSession & { tag: ActionKindTag.CreateSession })
  | (proto.Action_Deposit & { tag: ActionKindTag.Deposit })
  | (proto.Action_Withdraw & { tag: ActionKindTag.Withdraw })
  | (proto.Action_CancelOrderById & { tag: ActionKindTag.CancelOrderById })
  | (proto.Action_PlaceOrder & { tag: ActionKindTag.PlaceOrder });

export enum ActionKindTag {
  CreateUser,
  CreateSession,
  Deposit,
  Withdraw,
  CancelOrderById,
  PlaceOrder,
}

export interface CreateUserParams {
  keyType: KeyType;
  pubkey: Uint8Array;
}

export interface DepositParams {
  collateralId: number;
  userId: number;
  amount: Decimal;
}

export interface WithdrawParams {
  collateralId: number;
  userId: number;
  amount: Decimal;
}

export interface CreateSessionParams {
  userId: number;
  // Must be 96 bytes.
  blstPubkey: Uint8Array;
  expiryTs: bigint;
}

export interface PlaceOrderParams {
  userId: number;
  marketId: number;
  side: Side;
  fillMode: FillMode;
  isReduceOnly: boolean;
  price?: Decimal;
  size: Decimal;
  sessionId: number;
}

export interface CancelOrderParams {
  marketId: number;
  userId: number;
  orderId: bigint;
  sessionId: number;
}

export enum KeyType {
  Ed25119,
  Secp256k1,
  Bls12_381,
}

export enum Side {
  Ask,
  Bid,
}

export enum FillMode {
  Limit,
  PostOnly,
  ImmediateOrCancel,
  FillOrKill,
}

/**
 * Converts a `FillMode` enum to its corresponding protobuf representation.
 *
 * @param x - The fill mode to convert.
 * @returns The corresponding protobuf fill mode.
 * @throws Will throw an error if provided with an invalid fill mode.
 */
export function fillModeToProtoFillMode(x: FillMode): proto.Action_FillMode {
  if (x === FillMode.Limit) return proto.Action_FillMode.LIMIT;
  if (x === FillMode.PostOnly) return proto.Action_FillMode.POST_ONLY;
  if (x === FillMode.ImmediateOrCancel)
    return proto.Action_FillMode.IMMEDIATE_OR_CANCEL;
  if (x === FillMode.FillOrKill) return proto.Action_FillMode.FILL_OR_KILL;
  throw new Error("Invalid fill mode");
}
