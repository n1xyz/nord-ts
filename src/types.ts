import * as proto from "./gen/nord";

export type Actions =
  | proto.nord.Action.CreateSession
  | proto.nord.Action.Deposit
  | proto.nord.Action.Withdraw
  | proto.nord.Action.CancelOrderById
  | proto.nord.Action.PlaceOrder;

export interface DepositParams {
  tokenId: number;
  userId: number;
  amount: number;
}

export interface WithdrawParams {
  tokenId: number;
  sessionId: number;
  amount: number;
}

export interface CreateSessionParams {
  userId: number;
  keyType: KeyType;
  pubkey: Uint8Array;
  expiryTs: number;
}

export interface PlaceOrderParams {
  userId: number;
  marketId: number;
  side: Side;
  fillMode: FillMode;
  isReduceOnly: boolean;
  price: number;
  size: number;
  sessionId: number;
}

export interface CancelOrderParams {
  marketId: number;
  userId: number;
  orderId: number;
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

export interface ClientConfig {
  url: string;
  privateKey: Uint8Array;
}

export interface SubsriberConfig {
  streamURL: string;
  maxBufferLen?: number;
}

export interface Market {
  symbol: string;
  priceDecimals: number;
  sizeDecimals: number;
}

export interface Token {
  symbol: string;
  decimals: number;
}

export interface Info {
  markets: Market[];
  tokens: Token[];
}

export interface DeltaEvent {
  last_update_id: number;
  update_id: number;
  market_symbol: string;
  asks: [number, number];
  bids: [number, number];
}

/**
 * Converts a `FillMode` enum to its corresponding protobuf representation.
 *
 * @param x - The fill mode to convert.
 * @returns The corresponding protobuf fill mode.
 * @throws Will throw an error if provided with an invalid fill mode.
 */
export function fillModeToProtoFillMode(x: FillMode): proto.nord.FillMode {
  if (x === FillMode.Limit) return proto.nord.FillMode.LIMIT;
  if (x === FillMode.PostOnly) return proto.nord.FillMode.POST_ONLY;
  if (x === FillMode.ImmediateOrCancel) {
    return proto.nord.FillMode.IMMEDIATE_OR_CANCEL;
  }
  if (x === FillMode.FillOrKill) return proto.nord.FillMode.FILL_OR_KILL;
  throw new Error("Invalid fill mode");
}
