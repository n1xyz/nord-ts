import * as proto from "./gen/nord";

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

export interface NordConfig {
  evmUrl: string;
  webServerUrl: string;
  contractAddress: string;
  tokenInfos: ERC20TokenInfo[];
}

export interface ERC20TokenInfo {
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
  Ask,
  Bid,
}

export enum FillMode {
  Limit,
  PostOnly,
  ImmediateOrCancel,
  FillOrKill,
}

export interface SubscriberConfig {
  streamURL: string;
  maxBufferLen?: number;
}

export interface Market {
  symbol: string;
  baseTokenId: number;
  quoteTokenId: number;
  priceDecimals: number;
  sizeDecimals: number;
}

export interface Token {
  symbol: string;
  ethAddr: string;
  decimals: number;
  tokenId: number;
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

export interface Trade {
  side: Side;
  price: number;
  size: number;
  order_id: number;
}

export interface Trades {
  last_update_id: number;
  update_id: number;
  market_symbol: string;
  trades: Trade[];
}

export interface OrderInfo {
  id: number;
  reduce_only: boolean;
  imit_price: number;
  size: number;
  account_id: number;
}

interface HashMap<T> {
  [key: number]: T;
}

export interface Account {
  last_update_id: number;
  update_id: number;
  account_id: number;
  fills: HashMap<FillMode>;
  places: HashMap<OrderInfo>;
  cancels: HashMap<OrderInfo>;
  balances: HashMap<number>;
}

/**
 * Query the transactions in the specified L2 block.
 * @field {number} block_number specifies the block number to query.
 *                 If not specified, transactions from latest block
 *                 are returned.
 */
export interface BlockQuery {
  block_number?: number;
}

/**
 * Response for BlockQuery.
 * @field {number} block_number specifies the block number being returned.
 * @field {BlockActions} actions are the list of transactions from the block.
 */
export interface BlockResponse {
  block_number: number;
  actions: ActionInfo[];
}

/**
 * Response for BlockSummaryQuery.
 * @field {BlockSummary} block_summary is the summary of upto the last N blocks.
 *                       The server can return fewer than last_n block summary if
 *                       fewer blocks are available or if it exceeds a max cap.
 */
export interface BlockSummaryResponse {
  block_summary: BlockSummary[];
}

/**
 * Query the action for the specified action id.
 * @field {number} action_id specifies the action to query.
 */
export interface ActionQuery {
  action_id: number;
}

/**
 * Response for ActionQuery.
 * @field {number} block_number the block the action is part of.
 *                 If the action is not yet included in any block,
 *                 null is returned.
 * @field {Action} the transaction.
 */
export interface ActionResponse {
  block_number?: number;
  action: proto.Action;
}

/**
 * Query the recent actions
 * @field {number} last_n requests last N actions.
 * @field {number} action_id specifies the action to query.
 */
export interface ActionsQuery {
  last_n: number;
}

/**
 * Response for ActionsQuery.
 * @field {ActionsExtendedInfo} actions returns upto the last N actions.
 *                       The server can return fewer than last_n actions if
 *                       fewer actions are available or if it exceeds a max cap.
 */
export interface ActionsResponse {
  actions: ActionsExtendedInfo[];
}

/**
 * Block summary.
 * @field {number} block_number Block number.
 * @field {Action} from First action_id in the block.
 * @field {Action} to Last action_id in the block.
 */
export interface BlockSummary {
  block_number: number;
  from_action_id: number;
  to_action_id: number;
}

/**
 * Info about the block transaction.
 * @field {number} action_id is the action identifier.
 * @field {Action} action in protobuf format.
 */
export interface ActionInfo {
  action_id: number;
  action: proto.Action;
}

/**
 * Extended info about the block transaction.
 * @field {number} block_number the block the action is part of.
 *                 If the action is not yet included in any block,
 *                 null is returned.
 * @field {number} action_id of the action.
 * @field {Action} action the transaction.
 */
export interface ActionsExtendedInfo {
  block_number?: number;
  action_id: number;
  action: proto.Action;
}

/**
 * Aggregate metrics
 * @field {number} blocks_total: Total number of L2 blocks.
 * @field {number} tx_total: Total number of transactions.
 * @field {number} tx_tps: Transaction throughput.
 * @field {number} tx_tps_peak: Peak transaction throughput.
 * @field {number} request_latency_average: Average request latency.
 */
export interface AggregateMetrics {
  blocks_total: number;
  tx_total: number;
  tx_tps: number;
  tx_tps_peak: number;
  request_latency_average: number;
}

// The JSON types returned by rollman, that need to be translated to TS format.
export interface RollmanBlockResponse {
  block_number: number;
  actions: RollmanActionInfo[];
}

export interface RollmanActionResponse {
  block_number?: number;
  action_pb: Uint8Array;
}

export interface RollmanActionsResponse {
  actions: RollmanActionExtendedInfo[];
}

export interface RollmanActionInfo {
  action_id: number;
  action_pb: Uint8Array;
}

export interface RollmanActionExtendedInfo {
  block_number?: number;
  action_id: number;
  action_pb: Uint8Array;
}

export interface MarketsStatsResponse {
  markets: MarketStats[];
}

export interface MarketStats {
  market_id: number;
  index_price: number;
  volume_24h: number;
  high_24h: number;
  low_24h: number;
  mark_price?: number;
  funding_rate?: number;
  next_funding_time?: Date;
  open_interest?: number;
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
