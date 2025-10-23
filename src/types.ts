import * as proto from "./gen/nord_pb";
import type { components } from "./gen/openapi.ts";
import Decimal from "decimal.js";
import { toScaledU64 } from "./utils";

/**
 * The peak TPS rate is queried over the specified period.
 * The period is specified in units of: {hour, day, week, month, year}.
 * Example inputs:
 *  1. AggregateMetrics.txPeakTpsPeriod = 3,
 *     AggregateMetrics.txPeakTpsPeriodUnit = "d" => Peak TPS over last 3 days.
 *  1. AggregateMetrics.txPeakTpsPeriod = 1,
 *     AggregateMetrics.txPeakTpsPeriodUnit = "w" => Peak TPS over last week.
 */
export enum PeakTpsPeriodUnit {
  Hour = "h",
  Day = "d",
  Week = "w",
  Month = "m",
  Year = "y",
}

/**
 * Nord subscription type for trades or deltas
 */
export type SubscriptionType = "trades" | "deltas" | "account";

/**
 * Pattern for a valid Nord subscription
 * Format should be: "<type>@<parameter>"
 * Examples: "trades@BTCUSDC", "deltas@ETHUSDC", "account@42"
 */
export type SubscriptionPattern = `${SubscriptionType}@${string}` | string;

/**
 * Configuration options for the Nord client
 */
export interface NordConfig {
  /** Base URL for the Nord web server */
  webServerUrl: string;
  /** App address */
  app: string;
  /** Solana cluster URL */
  solanaUrl: string;
  /**
   * Whether to initialize WebSockets on creation, defaults to true
   * @deprecated this is a funky api we're gonna be removing it
   */
  initWebSockets?: boolean;
}

export type Info = components["schemas"]["Info2"];
export type Market = Info["markets"][number];
export type Token = Info["tokens"][number];
export type Account = components["schemas"]["Account"];
export type TradesResponse =
  components["schemas"]["PageResult_for_String_and_Trade"];
export type User = components["schemas"]["User"];
export type OrderbookResponse = components["schemas"]["OrderbookInfo"];
export type MarketStats = components["schemas"]["MarketStats"];
export type OrderbookInfo = components["schemas"]["OrderbookInfo"];
export type MarketStatsFromApi = components["schemas"]["MarketStats"];
export type TradeFromApi = components["schemas"]["Trade"];
// Generic PageResult type - note that K and V must match existing schema keys
export type PageResult<K extends string, V extends string> = K extends "String"
  ? V extends "OrderInfo"
    ? components["schemas"]["PageResult_for_String_and_OrderInfo"]
    : V extends "Trade"
      ? components["schemas"]["PageResult_for_String_and_Trade"]
      : never
  : never;
export type PageResultStringOrderInfo =
  components["schemas"]["PageResult_for_String_and_OrderInfo"];
export type PageResultStringTrade =
  components["schemas"]["PageResult_for_String_and_Trade"];
export type OrderInfoFromApi = components["schemas"]["OrderInfo"];
export type OpenOrder = components["schemas"]["OpenOrder"];
export type Balance = components["schemas"]["Balance"];
export type PositionSummary = components["schemas"]["PositionSummary"];
export type PerpPosition = components["schemas"]["PerpPosition"];
export type AccountMarginsView = components["schemas"]["AccountMarginsView"];
export type SideSummary = components["schemas"]["SideSummary"];
export type UserSession = components["schemas"]["UserSession"];
export type ActionsItem = components["schemas"]["ActionsItem"];
export type FillRole = components["schemas"]["FillRole"];
export type PerpMarketStatsFromApi = components["schemas"]["PerpMarketStats"];
export type SideFromApi = components["schemas"]["Side"];
export type FillModeFromApi = components["schemas"]["FillMode"];
export type PlacementOrigin = components["schemas"]["PlacementOrigin"];
export type FinalizationReason = components["schemas"]["FinalizationReason"];
export type AccountPnlQuery = components["schemas"]["AccountPnlQuery"];
export type AccountPnl = components["schemas"]["AccountPnl"];
export type AccountPnlPage =
  components["schemas"]["PageResult_for_uint64_and_AccountPnl"];

/**
 * Configuration options for the Nord client
 */
export interface TokenInfo {
  address: string;
  precision: number;
  tokenId: number;
  name: string;
}

export interface Order {
  orderId: number;
  isLong: boolean;
  size: number;
  price: number;
  marketId: number;
}

export enum KeyType {
  Ed25519,
  Secp256k1,
  Bls12_381,
}

export enum Side {
  Ask = "ask",
  Bid = "bid",
}

export enum FillMode {
  Limit,
  PostOnly,
  ImmediateOrCancel,
  FillOrKill,
}

export enum TriggerKind {
  StopLoss = 0,
  TakeProfit = 1,
}

export enum TriggerStatus {
  Active = 0,
  Success = 1,
  Cancel = 2,
  Remove = 4,
}

export interface SubscriberConfig {
  streamURL: string;
  maxBufferLen?: number;
}

export interface DeltaEvent {
  last_update_id: number;
  update_id: number;
  market_symbol: string;
  asks: OrderbookEntry[];
  bids: OrderbookEntry[];
}

export interface StreamTrade {
  side: Side;
  price: number;
  size: number;
  order_id: number;
}

export interface Trades {
  last_update_id: number;
  update_id: number;
  market_symbol: string;
  trades: StreamTrade[];
}

export interface LocalOrderInfo {
  id: number;
  reduce_only: boolean;
  limit_price: number;
  size: number;
  account_id: number;
  sender_tracking_id?: number;
}

export interface HashMap<T> {
  [key: number]: T;
}

export interface ActionResponse {
  actionId: number;
  action: proto.Action;
  physicalExecTime: Date;
}

/**
 * Block summary.
 * block_number Block number.
 * from_action_id First action_id in the block.
 * to_action_id Last action_id in the block.
 */
export interface BlockSummary {
  block_number: number;
  from_action_id: number;
  to_action_id: number;
}

/**
 * Aggregate metrics
 * blocks_total: Total number of L2 blocks.
 * tx_total: Total number of transactions.
 * tx_tps: Transaction throughput.
 * tx_tps_peak: Peak transaction throughput.
 * request_latency_average: Average request latency.
 */
export interface AggregateMetrics {
  blocks_total: number;
  tx_total: number;
  tx_tps: number;
  tx_tps_peak: number;
  request_latency_average: number;
}

/**
 * Converts a `FillMode` enum to its corresponding protobuf representation.
 *
 * @param x - The fill mode to convert.
 * @returns The corresponding protobuf fill mode.
 * @throws Will throw an error if provided with an invalid fill mode.
 */
export function fillModeToProtoFillMode(x: FillMode): proto.FillMode {
  if (x === FillMode.Limit) return proto.FillMode.LIMIT;
  if (x === FillMode.PostOnly) return proto.FillMode.POST_ONLY;
  if (x === FillMode.ImmediateOrCancel) {
    return proto.FillMode.IMMEDIATE_OR_CANCEL;
  }
  if (x === FillMode.FillOrKill) return proto.FillMode.FILL_OR_KILL;
  throw new Error("Invalid fill mode");
}

/**
 * Orderbook entry representing price and size
 */
export interface OrderbookEntry {
  price: number;
  size: number;
}

/**
 * Query parameters for orderbook
 *
 * Note: While you can provide either symbol or market_id, the API endpoint only accepts market_id.
 * If you provide a symbol, it will be converted to a market_id internally.
 */
export interface OrderbookQuery {
  symbol?: string;
  market_id?: number;
}

/**
 * Response for timestamp query
 */
export interface TimestampResponse {
  timestamp: number; // engine's current logical timestamp
}

/**
 * Response for action nonce query
 */
export interface ActionNonceResponse {
  nonce: number; // next expected action nonce
}

/**
 * WebSocket message types
 */
export enum WebSocketMessageType {
  TradeUpdate = "trades",
  DeltaUpdate = "delta",
  AccountUpdate = "account",
}

/**
 * WebSocket trade update message
 */
export interface WebSocketTradeUpdate {
  e: WebSocketMessageType.TradeUpdate;
  symbol: string;
  trades: StreamTrade[];
  timestamp: number;
}

/**
 * WebSocket delta update message
 */
export interface WebSocketDeltaUpdate {
  e: WebSocketMessageType.DeltaUpdate;
  last_update_id: number;
  update_id: number;
  market_symbol: string;
  asks: OrderbookEntry[];
  bids: OrderbookEntry[];
  timestamp: number;
}

/**
 * WebSocket user update message
 */
export interface WebSocketAccountUpdate {
  e: WebSocketMessageType.AccountUpdate;
  accountId: number;
  account: Account;
  timestamp: number;
}

export type WebSocketMessage =
  | WebSocketTradeUpdate
  | WebSocketDeltaUpdate
  | WebSocketAccountUpdate;

export interface SPLTokenInfo {
  mint: string;
  precision: number;
  tokenId: number;
  name: string;
}

// Positive decimal price and size.
// Example:
// ```
// const limit = new QuoteSize(new Decimal(114000), new Decimal(0.00035)),
//```
// Gives 40$ USD limit.
//
// Given price is same(or very close) to the market price,
// limit gives size tick as close as possible to settlemnt size tick.

// If you want to get smaller tick on client (on server it will not change),
// do `new QuoteSize(new Decimal(114000/2), new Decimal(0.00070))`.
// It will be 40$ limit, but may help if BTC suddently moves fast.
export class QuoteSize {
  price: Decimal;
  size: Decimal;
  /// Input can be only positive values.
  constructor(quotePrice: Decimal.Value, quoteSize: Decimal.Value) {
    const p = new Decimal(quotePrice);
    const s = new Decimal(quoteSize);
    if (!p.isPositive() || !s.isPositive()) {
      throw new Error("quotePrice and quoteSize must be positive");
    }
    this.price = p;
    this.size = s;
  }

  // USD value of limit, use for debug
  value(): Decimal {
    return this.price.mul(this.size);
  }

  // Converts to wire format to be send to server, scaling price and size according to market decimals.
  toWire(
    marketPriceDecimals: number,
    marketSizeDecimals: number,
  ): { price: bigint; size: bigint } {
    return {
      price: toScaledU64(this.price, marketPriceDecimals),
      size: toScaledU64(this.size, marketSizeDecimals),
    };
  }
}
