import { EventEmitter } from "events";
import {
  Account,
  ActionQuery,
  ActionResponse,
  ActionsResponse,
  AggregateMetrics,
  BlockQuery,
  BlockResponse,
  BlockSummaryResponse,
  Info,
  Market,
  MarketsStatsResponse,
  NordConfig,
  OrderbookQuery,
  OrderbookResponse,
  PeakTpsPeriodUnit,
  RollmanActionResponse,
  RollmanActionsResponse,
  RollmanBlockResponse,
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
 * Main Nord client class for interacting with the Nord API
 */
export class Nord {
  /** Base URL for the Nord web server */
  public readonly webServerUrl: string;

  /** Solana program ID */
  public readonly solanaProgramId: string;

  /** Solana RPC URL */
  public readonly solanaUrl: string;

  /** Available markets */
  public markets: Market[] = [];

  /** Available tokens */
  public tokens: Token[] = [];

  /** Map of symbol to market_id */
  private symbolToMarketId: Map<string, number> = new Map();

  /**
   * WebSocket client for trades
   * @private
   */
  private tradesWs: NordWebSocketClient | null = null;

  /**
   * WebSocket client for orderbook deltas
   * @private
   */
  private deltasWs: NordWebSocketClient | null = null;

  /**
   * WebSocket client for user updates
   * @private
   */
  private userWs: NordWebSocketClient | null = null;

  /**
   * Initial subscriptions for the trades WebSocket
   * @private
   */
  private tradesSubscriptions?: string[];

  /**
   * Initial subscriptions for the deltas WebSocket
   * @private
   */
  private deltasSubscriptions?: string[];

  /**
   * Create a new Nord client
   *
   * @param config - Configuration options for the Nord client
   * @param config.webServerUrl - Base URL for the Nord web server
   * @param config.solanaProgramId - Solana program ID
   * @param config.solanaUrl - Solana cluster URL
   * @param config.initWebSockets - Whether to initialize WebSockets on creation, defaults to true
   * @param config.tradesSubscriptions - Optional array of trades subscriptions to initialize with (e.g., ["trades@BTCUSDC"])
   * @param config.deltasSubscriptions - Optional array of deltas subscriptions to initialize with (e.g., ["deltas@BTCUSDC"])
   * @throws {Error} If required configuration is missing
   */
  constructor({
    webServerUrl,
    solanaProgramId,
    solanaUrl,
    initWebSockets = true,
    tradesSubscriptions,
    deltasSubscriptions,
  }: NordConfig) {
    if (!webServerUrl) {
      throw new NordError("webServerUrl is required");
    }

    if (!solanaProgramId) {
      throw new NordError("solanaProgramId is required");
    }

    if (!solanaUrl) {
      throw new NordError("solanaUrl is required");
    }

    this.webServerUrl = webServerUrl;
    this.solanaProgramId = solanaProgramId;
    this.solanaUrl = solanaUrl;

    // Store subscription parameters
    this.tradesSubscriptions = tradesSubscriptions;
    this.deltasSubscriptions = deltasSubscriptions;

    // Initialize WebSocket clients only if initWebSockets is true
    if (initWebSockets) {
      this.initializeWebSockets();
    }
  }

  /**
   * Initialize WebSocket clients for trades and deltas
   *
   * This method can be called manually if websockets were not initialized during construction
   * (i.e., if initWebSockets was set to false in the constructor).
   *
   * It initializes the trades and deltas WebSocket clients. The user WebSocket client
   * is initialized on demand when needed.
   *
   * @param tradesSubscriptions - Optional array of trades subscriptions to initialize with
   * @param deltasSubscriptions - Optional array of deltas subscriptions to initialize with
   */
  public initializeWebSockets(
    tradesSubscriptions?: string[],
    deltasSubscriptions?: string[],
  ): void {
    // Use provided subscriptions or fall back to stored ones
    const trades = tradesSubscriptions || this.tradesSubscriptions;
    const deltas = deltasSubscriptions || this.deltasSubscriptions;

    // Initialize WebSocket clients for each endpoint with subscriptions
    this.tradesWs = core.initWebSocketClient(
      this.webServerUrl,
      "trades",
      trades,
    );
    this.deltasWs = core.initWebSocketClient(
      this.webServerUrl,
      "deltas",
      deltas,
    );
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
   * @param nordConfig.solanaProgramId - Solana program ID
   * @param nordConfig.solanaUrl - Solana cluster URL
   * @param nordConfig.initWebSockets - Whether to initialize WebSockets on creation, defaults to true
   * @param nordConfig.tradesSubscriptions - Optional array of trades subscriptions (e.g., ["trades@BTCUSDC"])
   * @param nordConfig.deltasSubscriptions - Optional array of deltas subscriptions (e.g., ["deltas@BTCUSDC"])
   * @returns Initialized Nord client
   * @throws {NordError} If initialization fails
   */
  public static async initNord(nordConfig: NordConfig): Promise<Nord> {
    const nord = new Nord(nordConfig);
    await nord.fetchNordInfo();
    return nord;
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
   * Query a specific block
   *
   * @param query - Block query parameters
   * @returns Block response
   * @throws {NordError} If the request fails
   */
  async queryBlock(query: BlockQuery): Promise<BlockResponse> {
    return queries.queryBlock(this.webServerUrl, query);
  }

  /**
   * Query the last N blocks
   *
   * @returns Block response for the last N blocks
   * @throws {NordError} If the request fails
   */
  async queryLastNBlocks(): Promise<BlockResponse> {
    return queries.queryLastNBlocks(this.webServerUrl);
  }

  /**
   * Query recent blocks
   *
   * @param last_n - Number of recent blocks to query
   * @returns Block summary response
   * @throws {NordError} If the request fails
   */
  async queryRecentBlocks(last_n: number): Promise<BlockSummaryResponse> {
    return queries.queryRecentBlocks(this.webServerUrl, last_n);
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
   * @param last_n - Number of recent actions to query
   * @returns Actions response
   * @throws {NordError} If the request fails
   */
  async queryRecentActions(last_n: number): Promise<ActionsResponse> {
    return queries.queryRecentActions(this.webServerUrl, last_n);
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
   * Query a block from Rollman
   *
   * @param query - Block query parameters
   * @returns Rollman block response
   * @throws {NordError} If the request fails
   */
  async blockQueryRollman(query: BlockQuery): Promise<RollmanBlockResponse> {
    return queries.blockQueryRollman(this.webServerUrl, query);
  }

  /**
   * Query block summaries from Rollman
   *
   * @param last_n - Number of recent blocks to query
   * @returns Block summary response
   * @throws {NordError} If the request fails
   */
  async blockSummaryQueryRollman(
    last_n: number,
  ): Promise<BlockSummaryResponse> {
    return queries.blockSummaryQueryRollman(this.webServerUrl, last_n);
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
   * Get the trades WebSocket client (default)
   * If not already initialized, it will be created
   *
   * @returns WebSocket client for trades
   */
  public getWebSocketClient(): NordWebSocketClient {
    if (!this.tradesWs) {
      this.initializeWebSockets();
    }
    return this.tradesWs!;
  }

  /**
   * Get the trades WebSocket client
   * If not already initialized, it will be created
   *
   * @returns WebSocket client for trades
   */
  public getTradesWebSocketClient(): NordWebSocketClient {
    if (!this.tradesWs) {
      this.initializeWebSockets();
    }
    return this.tradesWs!;
  }

  /**
   * Get the deltas WebSocket client
   * If not already initialized, it will be created
   *
   * @returns WebSocket client for orderbook deltas
   */
  public getDeltasWebSocketClient(): NordWebSocketClient {
    if (!this.deltasWs) {
      this.initializeWebSockets();
    }
    return this.deltasWs!;
  }

  /**
   * Get the user WebSocket client
   * If not already initialized, it will be created
   *
   * @returns WebSocket client for user updates
   */
  public getUserWebSocketClient(): NordWebSocketClient {
    if (!this.userWs) {
      // Initialize user WebSocket client on demand
      this.userWs = core.initWebSocketClient(this.webServerUrl, "user");
      return this.userWs;
    }
    return this.userWs;
  }

  /**
   * Subscribe to orderbook updates for a market
   *
   * @param symbol - Market symbol
   * @returns Orderbook subscription
   */
  public subscribeOrderbook(symbol: string): OrderbookSubscription {
    const subscription = new EventEmitter() as OrderbookSubscription;

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

    // Initialize deltas websocket if it doesn't exist
    if (!this.deltasWs) {
      this.initializeWebSockets();
    }

    this.deltasWs!.on("delta", handleDelta);
    this.deltasWs!.subscribe([`deltas@${symbol}`]);

    subscription.close = () => {
      this.deltasWs!.unsubscribe([`deltas@${symbol}`]);
      this.deltasWs!.removeListener("delta", handleDelta);
      subscription.removeAllListeners();
    };

    return subscription;
  }

  /**
   * Subscribe to trade updates for a market
   *
   * @param symbol - Market symbol
   * @returns Trade subscription
   */
  public subscribeTrades(symbol: string): TradeSubscription {
    const subscription = new EventEmitter() as TradeSubscription;

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

    // Initialize trades websocket if it doesn't exist
    if (!this.tradesWs) {
      this.initializeWebSockets();
    }

    this.tradesWs!.on("trade", handleTrade);
    this.tradesWs!.subscribe([`trades@${symbol}`]);

    subscription.close = () => {
      this.tradesWs!.unsubscribe([`trades@${symbol}`]);
      this.tradesWs!.removeListener("trade", handleTrade);
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

    // Ensure market_id is provided
    if (query.market_id === undefined) {
      throw new NordError("market_id is required for orderbook query");
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
