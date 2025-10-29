import { ProtonClient } from "@n1xyz/proton";
import { Connection, PublicKey } from "@solana/web3.js";
import { EventEmitter } from "events";
import createClient, { Client, FetchOptions } from "openapi-fetch";
import * as proto from "../../gen/nord_pb";
import type { paths } from "../../gen/openapi.ts";
import {
  Account,
  AccountPnlPage,
  AccountPnlQuery,
  ActionResponse,
  AggregateMetrics,
  MarketsInfo,
  Market,
  MarketStats,
  NordConfig,
  OrderbookQuery,
  OrderbookResponse,
  PeakTpsPeriodUnit,
  SubscriptionPattern,
  Token,
  TradesResponse,
  User,
  AccountTriggerInfo,
  HistoryTriggerQuery,
  TriggerHistoryPage,
} from "../../types";
import * as utils from "../../utils";
import { NordWebSocketClient } from "../../websocket/index";
import * as core from "../api/core";
import * as metrics from "../api/metrics";
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

  /** Solana RPC URL */
  public readonly solanaUrl: string;

  /** Available markets */
  public markets: Market[] = [];

  /** Available tokens */
  public tokens: Token[] = [];

  /** Map of symbol to market_id */
  private symbolToMarketId: Map<string, number> = new Map();

  /** Proton client for proton related operations */
  public protonClient: ProtonClient;

  /** HTTP client for Nord operations */
  private httpClient: Client<paths>;

  /**
   * Create a new Nord client
   *
   * @param config - Configuration options for the Nord client
   * @param config.webServerUrl - Base URL for the Nord web server
   * @param config.solanaUrl - Solana cluster URL
   * @throws {Error} If required configuration is missing
   */
  private constructor({
    solanaUrl,
    webServerUrl,
    protonClient,
  }: Readonly<{
    solanaUrl: string;
    webServerUrl: string;
    protonClient: ProtonClient;
  }>) {
    this.webServerUrl = webServerUrl;
    this.solanaUrl = solanaUrl;
    this.protonClient = protonClient;
    this.httpClient = createClient<paths>({ baseUrl: webServerUrl });
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

  private async GET<P extends keyof paths & string>(
    path: P,
    options: FetchOptions<paths[P]["get"]>,
  ) {
    const r = await this.httpClient.GET(path, options);
    if (r.error) {
      throw new NordError(`failed to GET ${path}`, { cause: r.error });
    }
    if (r.data === undefined) {
      // this should never happen, but the type checker seems unhappy.
      // if we catch this we'll need to debug accordingly.
      throw new NordError("internal assertion violation", { cause: r });
    }
    return r.data;
  }

  /**
   * Get the current timestamp from the Nord server
   *
   * @returns Current timestamp as a bigint
   * @throws {NordError} If the request fails
   */
  async getTimestamp(): Promise<bigint> {
    return BigInt(await this.GET("/timestamp", {}));
  }

  /**
   * Get the last event nonce from the Nord server
   *
   * @returns Next action nonce
   * @throws {NordError} If the request fails
   */
  async getActionNonce(): Promise<number> {
    return await this.GET("/event/last-acked-nonce", {});
  }

  /**
   * Fetch information about Nord markets and tokens
   *
   * @throws {NordError} If the request fails
   */
  async fetchNordInfo(): Promise<void> {
    try {
      const info = await this.GET("/info", {});
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
   * @param nordConfig.app - App address
   * @param nordConfig.solanaUrl - Solana cluster URL
   * @returns Initialized Nord client
   * @throws {NordError} If initialization fails
   */
  public static async initNord({
    app,
    solanaUrl,
    webServerUrl,
  }: Readonly<NordConfig>): Promise<Nord> {
    // TODO: we should parametrize the connectionn not have it done here.
    // this is a dogshit api, only here to be compatible with the shitty
    // vibecoded code and not break zero one team's workflow.
    const connection = new Connection(solanaUrl, { commitment: "confirmed" });
    const protonClient = await ProtonClient.init({
      protonUrl: webServerUrl,
      bridgeVk: new PublicKey(app),
      solConn: connection,
    });
    const nord = new Nord({
      protonClient,
      solanaUrl,
      webServerUrl,
    });
    await nord.init();
    return nord;
  }

  /**
   * Initialize the Nord client
   * @private
   */
  private async init(): Promise<void> {
    await this.fetchNordInfo();
  }

  /**
   * Query a specific action
   *
   * @param query - Action query parameters
   * @returns Action response
   * @throws {NordError} If the request fails
   */
  async queryAction({
    action_id,
  }: {
    action_id: number;
  }): Promise<ActionResponse | null> {
    return (
      (
        await this.queryRecentActions({
          from: action_id,
          to: action_id,
        })
      )[0] ?? null
    );
  }

  /**
   * Query recent actions
   *
   * @param from - Starting action index
   * @param to - Ending action index
   * @returns Actions response
   * @throws {NordError} If the request fails
   */
  async queryRecentActions(query: {
    from: number;
    to: number;
  }): Promise<ActionResponse[]> {
    const xs = await this.GET("/action", {
      params: {
        query,
      },
    });
    return xs.map((x) => ({
      actionId: x.actionId,
      action: utils.decodeLengthDelimited(
        Buffer.from(x.payload, "base64"),
        proto.ActionSchema,
      ),
      physicalExecTime: new Date(x.physicalTime),
    }));
  }

  /**
   * Get the last action ID
   *
   * @returns Last action ID
   * @throws {NordError} If the request fails
   */
  async getLastActionId(): Promise<number> {
    return await this.GET("/action/last-executed-id", {});
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
  public async getTrades(
    query: Readonly<{
      marketId?: number;
      takerId?: number;
      makerId?: number;
      takerSide?: "bid" | "ask";
      pageSize?: number;
      sinceRcf3339?: string;
      untilRfc3339?: string;
      pageId?: string;
    }>,
  ): Promise<TradesResponse> {
    if (query.sinceRcf3339 && !utils.isRfc3339(query.sinceRcf3339)) {
      throw new NordError(`Invalid RFC3339 timestamp: ${query.sinceRcf3339}`);
    }
    if (query.untilRfc3339 && !utils.isRfc3339(query.untilRfc3339)) {
      throw new NordError(`Invalid RFC3339 timestamp: ${query.untilRfc3339}`);
    }
    return await this.GET("/trades", {
      params: {
        query: {
          takerId: query.takerId,
          makerId: query.makerId,
          marketId: query.marketId,
          pageSize: query.pageSize,
          takerSide: query.takerSide,
          since: query.sinceRcf3339,
          until: query.untilRfc3339,
          startInclusive: query.pageId,
        },
      },
    });
  }

  /**
   * Get user account IDs
   *
   * @param query - User account IDs query parameters
   * @returns User account IDs response
   * @throws {NordError} If the request fails
   */
  public async getUser(query: {
    pubkey: string | PublicKey;
  }): Promise<User | null> {
    const r = await this.httpClient.GET("/user/{pubkey}", {
      params: {
        path: { pubkey: query.pubkey.toString() },
      },
    });
    if (r.response.status === 404) {
      return null;
    }
    return r.data!;
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
    let marketId: number;
    if (query.symbol && query.market_id === undefined) {
      // If the map is empty, try to fetch market information first
      if (this.symbolToMarketId.size === 0) {
        await this.fetchNordInfo();
      }

      const id = this.symbolToMarketId.get(query.symbol);
      if (id === undefined) {
        throw new NordError(`Unknown market symbol: ${query.symbol}`);
      }
      marketId = id;
    } else if (query.market_id !== undefined) {
      marketId = query.market_id;
    } else {
      throw new NordError(
        "Either symbol or market_id must be provided for orderbook query",
      );
    }

    return await this.GET("/market/{market_id}/orderbook", {
      params: {
        path: { market_id: marketId },
      },
    });
  }

  /**
   * Get information about the Nord server
   *
   * @returns Information about markets and tokens
   * @throws {NordError} If the request fails
   */
  public async getInfo(): Promise<MarketsInfo> {
    return await this.GET("/info", {});
  }

  /**
   * Get account information
   *
   * @param accountId - Account ID to get information for
   * @returns Account information
   * @throws {NordError} If the request fails
   */
  public async getAccount(accountId: number): Promise<Account> {
    return await this.GET("/account/{account_id}", {
      params: {
        path: { account_id: accountId },
      },
    });
  }

  /**
   * Get profit and loss history for an account
   *
   * @param accountId - Account ID to query
   * @param query - Optional time and pagination filters
   * @returns Page of PnL entries ordered from latest to oldest
   * @throws {NordError} If the request fails
   */
  public async getAccountPnl(
    accountId: number,
    query?: Partial<AccountPnlQuery>,
  ): Promise<AccountPnlPage> {
    return await this.GET("/account/{account_id}/pnl", {
      params: {
        path: { account_id: accountId },
        query: {
          since: query?.since,
          until: query?.until,
          startInclusive: query?.startInclusive,
          pageSize: query?.pageSize,
        },
      },
    });
  }

  /**
   * Get market statistics (alias for marketsStats for backward compatibility)
   *
   * @returns Market statistics response
   */
  public async getMarketStats({
    marketId,
  }: {
    marketId: number;
  }): Promise<MarketStats> {
    return await this.GET("/market/{market_id}/stats", {
      params: {
        path: { market_id: marketId },
      },
    });
  }

  /**
   * Check if an account exists for the given address
   *
   * @param address - The public key address to check
   * @returns True if the account exists, false otherwise
   * @deprecated use getUser instead
   */
  public async accountExists(pubkey: string | PublicKey): Promise<boolean> {
    return !!(await this.getUser({ pubkey }));
  }

  /**
   * Fetch active triggers for an account.
   *
   * @param params Optional parameters containing an explicit account id.
   * @throws {NordError} If no account can be resolved or the request fails.
   */
  async getAccountTriggers(params?: {
    accountId?: number;
  }): Promise<AccountTriggerInfo[]> {
    const accountId = params?.accountId;

    if (accountId == null) {
      throw new NordError(
        "Account ID is undefined. Make sure to call updateAccountId() before requesting triggers.",
      );
    }

    try {
      const triggers = await this.GET("/account/{account_id}/triggers", {
        params: {
          path: { account_id: accountId },
        },
      });
      return triggers ?? [];
    } catch (error) {
      throw new NordError("Failed to fetch account triggers", { cause: error });
    }
  }

  /**
   * Fetch trigger history for an account.
   *
   * @param params Optional parameters with account id and history query filters.
   * @throws {NordError} If no account can be resolved or the request fails.
   */
  async getAccountTriggerHistory(
    params: HistoryTriggerQuery & { accountId?: number },
  ): Promise<TriggerHistoryPage> {
    const accountId = params?.accountId;

    if (accountId == null) {
      throw new NordError(
        "Account ID is undefined. Make sure to call updateAccountId() before requesting trigger history.",
      );
    }

    const { accountId: _, ...query } = params;
    try {
      return await this.GET("/account/{account_id}/triggers/history", {
        params: {
          path: { account_id: accountId },
          query: {
            since: query.since,
            until: query.until,
            pageSize: query.pageSize,
            startInclusive: query.startInclusive,
          },
        },
      });
    } catch (error) {
      throw new NordError("Failed to fetch account trigger history", {
        cause: error,
      });
    }
  }
}
