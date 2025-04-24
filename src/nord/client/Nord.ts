import { EventEmitter } from "events";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  Account,
  ActionQuery,
  ActionResponse,
  ActionsResponse,
  AggregateMetrics,
  Info,
  Market,
  MarketsStatsResponse,
  NordConfig,
  OrderbookQuery,
  OrderbookResponse,
  PeakTpsPeriodUnit,
  RollmanActionResponse,
  RollmanActionsResponse,
  SubscriptionPattern,
  Token,
  TradesQuery,
  TradesResponse,
  UserAccountIdsQuery,
  UserAccountIdsResponse,
} from "../../types";
import { NordWebSocketClient } from "../../websocket/index";
import * as core from "../api/core";
import * as market from "../api/market";
import * as metrics from "../api/metrics";
import * as queries from "../api/queries";
import { OrderbookSubscription, TradeSubscription } from "../models/Subscriber";
import { NordError } from "../utils/NordError";

/**
 * User subscription interface
 */
export interface UserSubscription extends EventEmitter {
  close: () => void;
}

/**
 * WebSocket subscription options interface
 */
export interface WebSocketSubscriptionOptions {
  /** Market symbols to subscribe to for trade updates */
  trades?: string[];
  /** Market symbols to subscribe to for orderbook delta updates */
  deltas?: string[];
  /** Account IDs to subscribe to for account updates */
  accounts?: number[];
}

/**
 * Main Nord client class for interacting with the Nord API
 */
export class Nord {
  /** Base URL for the Nord web server */
  public readonly webServerUrl: string;

  /** Bridge verification key */
  public readonly bridgeVk: string;

  /** Optional Solana program ID (will be derived from bridgeVk) */
  private _solanaProgramId!: string;

  /** Solana RPC URL */
  public readonly solanaUrl: string;

  /** Available markets */
  public markets: Market[] = [];

  /** Available tokens */
  public tokens: Token[] = [];

  /** Map of symbol to market_id */
  private symbolToMarketId: Map<string, number> = new Map();

  /**
   * Create a new Nord client
   *
   * @param config - Configuration options for the Nord client
   * @param config.webServerUrl - Base URL for the Nord web server
   * @param config.bridgeVk - Bridge verification key
   * @param config.solanaUrl - Solana cluster URL
   * @throws {Error} If required configuration is missing
   */
  constructor(config: NordConfig) {
    if (!config.webServerUrl) {
      throw new NordError("webServerUrl is required");
    }

    if (!config.bridgeVk) {
      throw new NordError("bridgeVk is required");
    }

    if (!config.solanaUrl) {
      throw new NordError("solanaUrl is required");
    }

    this.webServerUrl = config.webServerUrl;
    this.bridgeVk = config.bridgeVk;
    this.solanaUrl = config.solanaUrl;
  }

  /**
   * Create a WebSocket client with specific subscriptions
   *
   * @param options - Subscription options that specify which data streams to subscribe to
   * @returns A new WebSocket client with the requested subscriptions
   * @throws {NordError} If invalid subscription options are provided
   *
   * @example
   * // Create a client for trades and deltas from one market and an account
   * const wsClient = nord.createWebSocketClient({
   *   trades: ["BTCUSDC"],
   *   deltas: ["BTCUSDC"],
   *   accounts: [123]
   * });
   *
   * @example
   * // Create a client for trades from multiple markets
   * const tradesClient = nord.createWebSocketClient({
   *   trades: ["BTCUSDC", "ETHUSDC"]
   * });
   */
  public createWebSocketClient(
    options: WebSocketSubscriptionOptions,
  ): NordWebSocketClient {
    const subscriptions: SubscriptionPattern[] = [];

    // Add trade subscriptions
    if (options.trades && options.trades.length > 0) {
      options.trades.forEach((symbol) => {
        subscriptions.push(`trades@${symbol}` as SubscriptionPattern);
      });
    }

    // Add delta subscriptions
    if (options.deltas && options.deltas.length > 0) {
      options.deltas.forEach((symbol) => {
        subscriptions.push(`deltas@${symbol}` as SubscriptionPattern);
      });
    }

    // Add account subscriptions
    if (options.accounts && options.accounts.length > 0) {
      options.accounts.forEach((accountId) => {
        if (isNaN(accountId) || accountId <= 0) {
          throw new NordError(
            `Invalid account ID: ${accountId}. Must be a positive number.`,
          );
        }
        subscriptions.push(`account@${accountId}` as SubscriptionPattern);
      });
    }

    // Validate that at least one subscription was provided
    if (subscriptions.length === 0) {
      throw new NordError("At least one subscription must be provided");
    }

    // Create and return a new WebSocket client
    return core.initWebSocketClient(this.webServerUrl, subscriptions);
  }

  /**
   * Get the current timestamp from the Nord server
   *
   * @returns Current timestamp as a bigint
   * @throws {NordError} If the request fails
   */
  async getTimestamp(): Promise<bigint> {
    return core.getTimestamp(this.webServerUrl);
  }

  /**
   * Get the next action nonce from the Nord server
   *
   * @returns Next action nonce
   * @throws {NordError} If the request fails
   */
  async getActionNonce(): Promise<number> {
    return core.getActionNonce(this.webServerUrl);
  }

  /**
   * Fetch information about Nord markets and tokens
   *
   * @throws {NordError} If the request fails
   */
  async fetchNordInfo(): Promise<void> {
    try {
      const info = await core.getInfo(this.webServerUrl);
      this.markets = info.markets;
      this.tokens = info.tokens;

      // Populate the symbolToMarketId map
      this.symbolToMarketId.clear();
      info.markets.forEach((market) => {
        this.symbolToMarketId.set(market.symbol, market.marketId);
      });
    } catch (error) {
      throw new NordError("Failed to fetch Nord info", { cause: error });
    }
  }

  /**
   * Initialize a new Nord client
   *
   * @param nordConfig - Configuration options for the Nord client
   * @param nordConfig.webServerUrl - Base URL for the Nord web server
   * @param nordConfig.bridgeVk - Bridge verification key
   * @param nordConfig.solanaUrl - Solana cluster URL
   * @returns Initialized Nord client
   * @throws {NordError} If initialization fails
   */
  public static async initNord(nordConfig: NordConfig): Promise<Nord> {
    const nord = new Nord(nordConfig);
    await nord.init();
    return nord;
  }

  /**
   * Initialize the Nord client by deriving program ID and fetching info
   * @private
   */
  private async init(): Promise<void> {
    const connection = new Connection(this.solanaUrl);
    const bridgeVkPubkey = new PublicKey(this.bridgeVk);

    const bridgeAccount = await connection.getAccountInfo(bridgeVkPubkey);
    if (!bridgeAccount) {
      throw new NordError(`Bridge account ${this.bridgeVk} not found`);
    }

    this._solanaProgramId = bridgeAccount.owner.toString();
    await this.fetchNordInfo();
  }

  /**
   * Get the Solana program ID derived from bridge VK
   *
   * @returns Program ID string
   * @throws {NordError} If program ID hasn't been initialized
   */
  public getSolanaProgramId(): string {
    if (!this._solanaProgramId) {
      throw new NordError(
        "Solana program ID not initialized. Have you called Nord.initNord()?",
      );
    }
    return this._solanaProgramId;
  }

  /**
   * Get market statistics
   *
   * @returns Market statistics response
   * @throws {NordError} If the request fails
   */
  public async marketsStats(): Promise<MarketsStatsResponse> {
    return market.marketsStats(this.webServerUrl);
  }

  /**
   * Query a specific action
   *
   * @param query - Action query parameters
   * @returns Action response
   * @throws {NordError} If the request fails
   */
  async queryAction(query: ActionQuery): Promise<ActionResponse> {
    return queries.queryAction(this.webServerUrl, query);
  }

  /**
   * Query recent actions
   *
   * @param from - Starting action index
   * @param to - Ending action index
   * @returns Actions response
   * @throws {NordError} If the request fails
   */
  async queryRecentActions(from: number, to: number): Promise<ActionsResponse> {
    return queries.queryRecentActions(this.webServerUrl, from, to);
  }

  /**
   * Get the last action ID
   *
   * @returns Last action ID
   * @throws {NordError} If the request fails
   */
  async getLastActionId(): Promise<number> {
    return queries.getLastActionId(this.webServerUrl);
  }

  /**
   * Fetch aggregate metrics from the Nord API
   *
   * @param txPeakTpsPeriod - Period for peak TPS calculation
   * @param txPeakTpsPeriodUnit - Unit for peak TPS period
   * @returns Aggregate metrics
   * @throws {NordError} If the request fails
   */
  async aggregateMetrics(
    txPeakTpsPeriod = 1,
    txPeakTpsPeriodUnit: PeakTpsPeriodUnit = PeakTpsPeriodUnit.Day,
  ): Promise<AggregateMetrics> {
    return metrics.aggregateMetrics(
      this.webServerUrl,
      txPeakTpsPeriod,
      txPeakTpsPeriodUnit,
    );
  }

  /**
   * Get current transactions per second
   *
   * @param period - Time period for the query
   * @returns Current TPS value
   * @throws {NordError} If the request fails
   */
  async getCurrentTps(period: string = "1m") {
    return metrics.getCurrentTps(this.webServerUrl, period);
  }

  /**
   * Get peak transactions per second
   *
   * @param period - Time period for the query
   * @returns Peak TPS value
   * @throws {NordError} If the request fails
   */
  async getPeakTps(period: string = "24h") {
    return metrics.getPeakTps(this.webServerUrl, period);
  }

  /**
   * Get median transaction latency
   *
   * @param period - Time period for the query
   * @returns Median latency in milliseconds
   * @throws {NordError} If the request fails
   */
  async getMedianLatency(period: string = "1m") {
    return metrics.getMedianLatency(this.webServerUrl, period);
  }

  /**
   * Get total transaction count
   *
   * @returns Total transaction count
   * @throws {NordError} If the request fails
   */
  async getTotalTransactions() {
    return metrics.getTotalTransactions(this.webServerUrl);
  }

  /**
   * Query an action from Rollman
   *
   * @param query - Action query parameters
   * @returns Rollman action response
   * @throws {NordError} If the request fails
   */
  async actionQueryRollman(query: ActionQuery): Promise<RollmanActionResponse> {
    return queries.actionQueryRollman(this.webServerUrl, query);
  }

  /**
   * Query actions from Rollman
   *
   * @param last_n - Number of recent actions to query
   * @returns Rollman actions response
   * @throws {NordError} If the request fails
   */
  async actionsQueryRollman(last_n: number): Promise<RollmanActionsResponse> {
    return queries.actionsQueryRollman(this.webServerUrl, last_n);
  }

  /**
   * Query Prometheus metrics
   *
   * @param params - Prometheus query parameters
   * @returns Query result as a number
   * @throws {NordError} If the request fails
   */
  async queryPrometheus(params: string): Promise<number> {
    return metrics.queryPrometheus(this.webServerUrl, params);
  }

  /**
   * Subscribe to orderbook updates for a market
   *
   * @param symbol - Market symbol
   * @returns Orderbook subscription
   * @throws {NordError} If symbol is invalid
   */
  public subscribeOrderbook(symbol: string): OrderbookSubscription {
    if (!symbol || typeof symbol !== "string") {
      throw new NordError("Invalid market symbol");
    }

    const subscription = new EventEmitter() as OrderbookSubscription;
    const wsClient = this.createWebSocketClient({
      deltas: [symbol],
    });

    const handleDelta = (update: {
      symbol: string;
      bids: [number, number][];
      asks: [number, number][];
    }) => {
      if (update.symbol !== symbol) {
        return;
      }

      subscription.emit("message", update);
    };

    wsClient.on("delta", handleDelta);

    subscription.close = () => {
      wsClient.unsubscribe([`deltas@${symbol}`]);
      wsClient.removeListener("delta", handleDelta);
      subscription.removeAllListeners();
    };

    return subscription;
  }

  /**
   * Subscribe to trade updates for a market
   *
   * @param symbol - Market symbol
   * @returns Trade subscription
   * @throws {NordError} If symbol is invalid
   */
  public subscribeTrades(symbol: string): TradeSubscription {
    if (!symbol || typeof symbol !== "string") {
      throw new NordError("Invalid market symbol");
    }

    const subscription = new EventEmitter() as TradeSubscription;
    const wsClient = this.createWebSocketClient({
      trades: [symbol],
    });

    const handleTrade = (update: {
      symbol: string;
      trades: Array<{
        price: number;
        size: number;
        side: string;
        timestamp: number;
      }>;
    }) => {
      if (update.symbol !== symbol) {
        return;
      }

      subscription.emit("message", update);
    };

    wsClient.on("trades", handleTrade);

    subscription.close = () => {
      wsClient.unsubscribe([`trades@${symbol}`]);
      wsClient.removeListener("trades", handleTrade);
      subscription.removeAllListeners();
    };

    return subscription;
  }

  /**
   * Subscribe to account updates
   *
   * @param accountId - Account ID to subscribe to
   * @returns User subscription
   * @throws {NordError} If accountId is invalid
   */
  public subscribeAccount(accountId: number): UserSubscription {
    if (isNaN(accountId) || accountId <= 0) {
      throw new NordError("Invalid account ID");
    }

    const subscription = new EventEmitter() as UserSubscription;
    const wsClient = this.createWebSocketClient({
      accounts: [accountId],
    });

    const handleAccountUpdate = (update: any) => {
      if (update.account_id !== accountId) {
        return;
      }

      subscription.emit("message", update);
    };

    wsClient.on("account", handleAccountUpdate);

    subscription.close = () => {
      wsClient.unsubscribe([`account@${accountId}`]);
      wsClient.removeListener("account", handleAccountUpdate);
      subscription.removeAllListeners();
    };

    return subscription;
  }

  /**
   * Get trades for a market
   *
   * @param query - Trades query parameters
   * @returns Trades response
   * @throws {NordError} If the request fails
   */
  public async getTrades(query: TradesQuery): Promise<TradesResponse> {
    return market.getTrades(this.webServerUrl, query);
  }

  /**
   * Get user account IDs
   *
   * @param query - User account IDs query parameters
   * @returns User account IDs response
   * @throws {NordError} If the request fails
   */
  public async getUserAccountIds(
    query: UserAccountIdsQuery,
  ): Promise<UserAccountIdsResponse> {
    return market.getUserAccountIds(this.webServerUrl, query);
  }

  /**
   * Get orderbook for a market
   *
   * @param query - Orderbook query parameters (either market_id or symbol must be provided)
   * @returns Orderbook response
   * @throws {NordError} If the request fails or if the market symbol is unknown
   * @remarks It's recommended to initialize the Nord client using the static `initNord` method
   * to ensure market information is properly loaded before calling this method.
   */
  public async getOrderbook(query: OrderbookQuery): Promise<OrderbookResponse> {
    // If only symbol is provided, convert it to market_id
    if (query.symbol && query.market_id === undefined) {
      // If the map is empty, try to fetch market information first
      if (this.symbolToMarketId.size === 0) {
        await this.fetchNordInfo();
      }

      const marketId = this.symbolToMarketId.get(query.symbol);
      if (marketId === undefined) {
        throw new NordError(`Unknown market symbol: ${query.symbol}`);
      }

      query = { market_id: marketId };
    }

    return market.getOrderbook(this.webServerUrl, query);
  }

  /**
   * Get information about the Nord server
   *
   * @returns Information about markets and tokens
   * @throws {NordError} If the request fails
   */
  public async getInfo(): Promise<Info> {
    return core.getInfo(this.webServerUrl);
  }

  /**
   * Get account information
   *
   * @param accountId - Account ID to get information for
   * @returns Account information
   * @throws {NordError} If the request fails
   */
  public async getAccount(accountId: number): Promise<Account> {
    return core.getAccount(this.webServerUrl, accountId);
  }

  /**
   * Get market statistics (alias for marketsStats for backward compatibility)
   *
   * @deprecated Use marketsStats instead
   * @returns Market statistics response
   */
  public async getMarketStats(): Promise<MarketsStatsResponse> {
    return this.marketsStats();
  }

  /**
   * Check if an account exists for the given address
   *
   * @param address - The public key address to check
   * @returns True if the account exists, false otherwise
   */
  public async accountExists(address: string): Promise<boolean> {
    try {
      await market.getUserAccountIds(this.webServerUrl, { pubkey: address });
      return true;
    } catch {
      return false;
    }
  }
}
