import { ProtonClient } from "@n1xyz/proton";
import { Connection, PublicKey } from "@solana/web3.js";
import { EventEmitter } from "events";
import createClient, { Client, FetchOptions } from "openapi-fetch";
import * as proto from "../gen/nord_pb";
import type { paths } from "../gen/openapi.ts";
import {
  Account,
  AccountPnlInfoPage,
  WebSocketDeltaUpdate,
  WebSocketTradeUpdate,
  WebSocketAccountUpdate,
  PagedQuery,
  ActionResponse,
  MarketsInfo,
  Market,
  MarketStats,
  NordConfig,
  OrderbookQuery,
  OrderbookResponse,
  FeeTierConfig,
  SubscriptionPattern,
  Token,
  TradesResponse,
  User,
  AccountTriggerInfo,
  TriggerHistoryPage,
  WithdrawalHistoryPage,
  FeeTierId,
  AccountFeeTierPage,
  PageResultStringOrderInfo,
  PageResultStringTrade,
  OrderInfoFromApi,
  TokenStats,
  FillRole,
  AdminInfo,
  AccountVolumeInfo,
  GetAccountVolumeQuery,
  PreviousMarketPrice,
} from "../types";
import * as utils from "../utils";
import { NordWebSocketClient } from "../websocket/index";
import { initWebSocketClient } from "../websocket";
import {
  OrderbookSubscription,
  TradeSubscription,
} from "../websocket/Subscriber";
import { NordError } from "../error";

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

  /** Solana RPC URL */
  public readonly solanaConnection: Connection;

  /** Available markets */
  public markets: Market[] = [];

  /** Available tokens */
  public tokens: Token[] = [];

  /** Map of symbol to market_id */
  private symbolToMarketId: Map<string, number> = new Map();

  /** Proton client for proton related operations */
  public protonClient: ProtonClient;

  /** HTTP client for Nord operations */
  public readonly httpClient: Client<paths>;

  /**
   * Create a new Nord client
   *
   * @param config - Configuration options for the Nord client
   * @param config.webServerUrl - Base URL for the Nord web server
   * @param config.solanaUrl - Solana cluster URL
   * @throws {Error} If required configuration is missing
   */
  private constructor({
    solanaConnection,
    webServerUrl,
    protonClient,
  }: Readonly<{
    solanaConnection: Connection;
    webServerUrl: string;
    protonClient: ProtonClient;
  }>) {
    this.webServerUrl = webServerUrl;
    this.solanaConnection = solanaConnection;
    this.protonClient = protonClient;
    this.httpClient = createClient<paths>({ baseUrl: webServerUrl });
  }

  /**
   * Create a WebSocket client with specific subscriptions
   *
   * @param trades - Market symbols to subscribe to for trade updates
   * @param deltas - Market symbols to subscribe to for orderbook delta updates
   * @param accounts - Account IDs to subscribe to for account updates
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
  public createWebSocketClient({
    trades,
    deltas,
    accounts,
  }: Readonly<{
    trades?: string[];
    deltas?: string[];
    accounts?: number[];
  }>): NordWebSocketClient {
    const subscriptions: SubscriptionPattern[] = [];

    // Add trade subscriptions
    if (trades && trades.length > 0) {
      trades.forEach((symbol) => {
        subscriptions.push(`trades@${symbol}` as SubscriptionPattern);
      });
    }

    // Add delta subscriptions
    if (deltas && deltas.length > 0) {
      deltas.forEach((symbol) => {
        subscriptions.push(`deltas@${symbol}` as SubscriptionPattern);
      });
    }

    // Add account subscriptions
    if (accounts && accounts.length > 0) {
      accounts.forEach((accountId) => {
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
    return initWebSocketClient(this.webServerUrl, subscriptions);
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
   * Get the admin list from the Nord server
   *
   * @returns List of admin registration keys paired with their ACL role mask
   * @throws {NordError} If the request fails
   */
  async getAdminList(): Promise<Array<AdminInfo>> {
    return await this.GET("/admin", {});
  }

  /**
   * Get account volume across all markets, optionally for a specific market.
   *
   * @param accountId - Account identifier
   * @param since - RFC3339 timestamp marking the inclusive start of the window
   * @param until - RFC3339 timestamp marking the exclusive end of the window
   * @param marketId - Optional market identifier to scope the volume
   * @returns Array of market volumes (single entry when `marketId` is provided)
   * @throws {NordError} If the request fails
   */
  async getAccountVolume({
    accountId,
    since,
    until,
    marketId,
  }: Readonly<GetAccountVolumeQuery>): Promise<Array<AccountVolumeInfo>> {
    return await this.GET("/account/volume", {
      params: {
        query: {
          accountId,
          since,
          until,
          marketId,
        },
      },
    });
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

  /** @deprecated use Nord.new */
  public static async initNord(x: Readonly<NordConfig>): Promise<Nord> {
    return await Nord.new(x);
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
  public static async new({
    app,
    solanaConnection,
    webServerUrl,
    protonUrl,
  }: Readonly<NordConfig>): Promise<Nord> {
    const protonClient = await ProtonClient.init({
      protonUrl: protonUrl ?? webServerUrl,
      app: new PublicKey(app),
      solConn: solanaConnection,
    });
    const nord = new Nord({
      protonClient,
      solanaConnection,
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
   * @param actionId - Action identifier to fetch
   * @returns Action response
   * @throws {NordError} If the request fails
   */
  async queryAction({
    actionId,
  }: Readonly<{
    actionId: number;
  }>): Promise<ActionResponse | null> {
    return (
      (
        await this.queryRecentActions({
          from: actionId,
          to: actionId,
        })
      )[0] ?? null
    );
  }

  /**
   * Query recent actions
   *
   * @param from - Starting action index (inclusive)
   * @param to - Ending action index (inclusive)
   * @returns Actions response
   * @throws {NordError} If the request fails
   */
  async queryRecentActions({
    from,
    to,
  }: Readonly<{
    from: number;
    to: number;
  }>): Promise<ActionResponse[]> {
    const xs = await this.GET("/action", {
      params: {
        query: { from, to },
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

    const handleDelta = (update: WebSocketDeltaUpdate) => {
      if (update.market_symbol !== symbol) {
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

    const handleTrade = (update: WebSocketTradeUpdate) => {
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

    const handleAccountUpdate = (update: WebSocketAccountUpdate) => {
      if (update.accountId !== accountId) {
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
   * @param marketId - Market identifier to filter by
   * @param takerId - Taker account identifier
   * @param makerId - Maker account identifier
   * @param takerSide - Side executed by the taker
   * @param pageSize - Maximum number of trades to return
   * @param since - RFC3339 timestamp to start from (inclusive)
   * @param until - RFC3339 timestamp to end at (exclusive)
   * @param pageId - Pagination cursor returned from a prior call
   * @returns Trades response
   * @throws {NordError} If the request fails
   */
  public async getTrades({
    marketId,
    takerId,
    makerId,
    takerSide,
    pageSize,
    since,
    until,
    startInclusive,
  }: Readonly<{
    marketId?: number;
    takerId?: number;
    makerId?: number;
    takerSide?: "bid" | "ask";
    pageSize?: number;
    since?: string;
    until?: string;
    startInclusive?: string;
  }>): Promise<TradesResponse> {
    if (since && !utils.isRfc3339(since)) {
      throw new NordError(`Invalid RFC3339 timestamp: ${since}`);
    }
    if (until && !utils.isRfc3339(until)) {
      throw new NordError(`Invalid RFC3339 timestamp: ${until}`);
    }
    return await this.GET("/trades", {
      params: {
        query: {
          takerId,
          makerId,
          marketId,
          pageSize,
          takerSide,
          since,
          until,
          startInclusive,
        },
      },
    });
  }

  /**
   * Get user account IDs
   *
   * @param pubkey - User public key to query
   * @returns User account IDs response
   * @throws {NordError} If the request fails
   */
  public async getUser({
    pubkey,
  }: Readonly<{
    pubkey: string | PublicKey;
  }>): Promise<User | null> {
    const r = await this.httpClient.GET("/user/{pubkey}", {
      params: {
        path: { pubkey: pubkey.toString() },
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
   * @param symbol - Market symbol to resolve into an id
   * @param marketId - Market identifier
   * @returns Orderbook response
   * @throws {NordError} If the request fails or if the market symbol is unknown
   * @remarks It's recommended to initialize the Nord client using the static `initNord` method
   * to ensure market information is properly loaded before calling this method.
   */
  public async getOrderbook({
    symbol,
    marketId,
  }: OrderbookQuery): Promise<OrderbookResponse> {
    // If only symbol is provided, convert it to market_id
    let _marketId: number;
    if (symbol && marketId === undefined) {
      // If the map is empty, try to fetch market information first
      if (this.symbolToMarketId.size === 0) {
        await this.fetchNordInfo();
      }

      const id = this.symbolToMarketId.get(symbol);
      if (id === undefined) {
        throw new NordError(`Unknown market symbol: ${symbol}`);
      }
      _marketId = id;
    } else if (marketId !== undefined) {
      _marketId = marketId;
    } else {
      throw new NordError(
        "Either symbol or market_id must be provided for orderbook query",
      );
    }

    return await this.GET("/market/{market_id}/orderbook", {
      params: {
        path: { market_id: _marketId },
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
   * Fetch the current fee tier brackets configured on Nord.
   *
   * @returns Array of fee tier identifiers paired with their configuration
   * @throws {NordError} If the request fails
   */
  public async getFeeBrackets(): Promise<Array<[FeeTierId, FeeTierConfig]>> {
    return await this.GET("/fee/brackets/info", {});
  }

  /**
   * Retrieve the fee tier assigned to a specific account.
   *
   * @param accountId - Account identifier to query
   * @returns Fee tier details for the requested account
   * @throws {NordError} If the request fails
   */
  public async getAccountFeeTier(accountId: number): Promise<FeeTierId> {
    return await this.GET("/account/{account_id}/fee/tier", {
      params: {
        path: { account_id: accountId },
      },
    });
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
   * Get the public key associated with an account id.
   *
   * @param accountId - Account id to query
   * @returns Base58-encoded account public key
   * @throws {NordError} If the request fails
   */
  public async getAccountPubkey(accountId: number): Promise<string> {
    return await this.GET("/account/{account_id}/pubkey", {
      params: {
        path: { account_id: accountId },
      },
    });
  }

  /**
   * Get the withdrawal fee charged for an account.
   *
   * @param accountId - Account id to query
   * @returns Withdrawal fee quoted in quote token units
   * @throws {NordError} If the request fails
   */
  public async getAccountWithdrawalFee(accountId: number): Promise<number> {
    return await this.GET("/account/{account_id}/fees/withdrawal", {
      params: {
        path: { account_id: accountId },
      },
    });
  }

  /**
   * Get open orders for an account.
   *
   * @param accountId - Account id to query
   * @param startInclusive - Pagination cursor (client order id) to resume from
   * @param pageSize - Maximum number of orders to return
   * @returns Page of orders keyed by client order id
   * @throws {NordError} If the request fails
   */
  public async getAccountOrders(
    accountId: number,
    {
      startInclusive,
      pageSize,
    }: Readonly<{
      startInclusive?: string | null;
      pageSize?: number | null;
    }> = {},
  ): Promise<PageResultStringOrderInfo> {
    return await this.GET("/account/{account_id}/orders", {
      params: {
        path: { account_id: accountId },
        query: {
          startInclusive,
          pageSize,
        },
      },
    });
  }

  /**
   * List account fee tiers with pagination support.
   *
   * @param startInclusive - Account id cursor to resume from
   * @param pageSize - Maximum number of entries to return
   */
  public async getAccountsFeeTiers({
    startInclusive,
    pageSize,
  }: Readonly<{
    startInclusive?: number | null;
    pageSize?: number | null;
  }> = {}): Promise<AccountFeeTierPage> {
    return await this.GET("/accounts/fee-tiers", {
      params: {
        query: {
          startInclusive: startInclusive ?? undefined,
          pageSize: pageSize ?? undefined,
        },
      },
    });
  }

  /**
   * Get profit and loss history for an account
   *
   * @param accountId - Account ID to query
   * @param since - RFC3339 timestamp to start from (inclusive)
   * @param until - RFC3339 timestamp to end at (exclusive)
   * @param startInclusive - Pagination cursor to resume from
   * @param pageSize - Maximum number of entries to return
   * @returns Page of PnL entries ordered from latest to oldest
   * @throws {NordError} If the request fails
   */
  public async getAccountPnl(
    accountId: number,
    {
      since,
      until,
      startInclusive,
      pageSize,
    }: Readonly<Partial<PagedQuery>> = {},
  ): Promise<AccountPnlInfoPage> {
    return await this.GET("/account/{account_id}/pnl", {
      params: {
        path: { account_id: accountId },
        query: {
          since,
          until,
          startInclusive,
          pageSize,
        },
      },
    });
  }

  /**
   * Get market statistics (alias for marketsStats for backward compatibility)
   *
   *
   * @param marketId - Market identifier
   *
   * @returns Market statistics response
   */
  public async getMarketStats({
    marketId,
  }: Readonly<{
    marketId: number;
  }>): Promise<MarketStats> {
    return await this.GET("/market/{market_id}/stats", {
      params: {
        path: { market_id: marketId },
      },
    });
  }

  /**
   * Fetch the per-market fee quote for an account.
   *
   * @param marketId - Market identifier
   * @param feeKind - Fill role (maker/taker) to quote
   * @param accountId - Account identifier to quote
   * @returns Fee in quote token units (negative means fee is charged)
   * @throws {NordError} If the request fails
   */
  public async getMarketFee({
    marketId,
    feeKind,
    accountId,
  }: Readonly<{
    marketId: number;
    feeKind: FillRole;
    accountId: number;
  }>): Promise<number> {
    return await this.GET("/market/{market_id}/fees/{fee_kind}/{account_id}", {
      params: {
        path: {
          market_id: marketId,
          fee_kind: feeKind,
          account_id: accountId,
        },
      },
    });
  }

  /**
   * Fetch the latest available market price at or before the given timestamp.
   *
   * @param marketId - Market identifier
   * @param atOrBefore - RFC3339 timestamp to look back from (returns the latest price at or before this time)
   * @returns Previous market price record; price is `null` if no trades exist at or before `at`
   * @throws {NordError} If the request fails
   */
  public async getPrevMarketPrice({
    marketId,
    atOrBefore,
  }: Readonly<{
    marketId: number;
    atOrBefore: string;
  }>): Promise<PreviousMarketPrice> {
    return await this.GET("/market/{market_id}/price/prev", {
      params: {
        path: { market_id: marketId },
        query: {
          atOrBefore,
        },
      },
    });
  }

  /**
   * Fetch token statistics such as index price and oracle metadata.
   *
   * @param tokenId - Token identifier
   * @returns Token stats
   * @throws {NordError} If the request fails
   */
  public async getTokenStats(tokenId: number): Promise<TokenStats> {
    return await this.GET("/tokens/{token_id}/stats", {
      params: {
        path: { token_id: tokenId },
      },
    });
  }

  /**
   * Get order summary by order id.
   *
   * @param orderId - Order identifier
   * @returns Order information
   * @throws {NordError} If the request fails
   */
  public async getOrder(orderId: string): Promise<OrderInfoFromApi> {
    return await this.GET("/order/{order_id}", {
      params: {
        path: { order_id: orderId },
      },
    });
  }

  /**
   * Get trade history for a specific order.
   *
   * @param orderId - Order identifier
   * @param startInclusive - Trade pagination cursor
   * @param pageSize - Maximum number of trades to return
   * @returns Page of trades associated with the order
   * @throws {NordError} If the request fails
   */
  public async getOrderTrades(
    orderId: string,
    {
      startInclusive,
      pageSize,
    }: Readonly<{
      startInclusive?: string | null;
      pageSize?: number | null;
    }> = {},
  ): Promise<PageResultStringTrade> {
    return await this.GET("/order/{order_id}/trades", {
      params: {
        path: { order_id: orderId },
        query: {
          startInclusive,
          pageSize,
        },
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
   * @param accountId - Account identifier owning the triggers
   * @throws {NordError} If no account can be resolved or the request fails.
   */
  async getAccountTriggers({
    accountId,
  }: Readonly<{
    accountId?: number;
  }> = {}): Promise<AccountTriggerInfo[]> {
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
   * @param accountId - Account identifier owning the triggers
   * @param since - RFC3339 timestamp to start from (inclusive)
   * @param until - RFC3339 timestamp to end at (exclusive)
   * @param pageSize - Maximum number of entries to return
   * @param startInclusive - Pagination cursor to resume from
   * @throws {NordError} If no account can be resolved or the request fails.
   */
  async getAccountTriggerHistory({
    accountId,
    since,
    until,
    pageSize,
    startInclusive,
  }: Readonly<
    PagedQuery & { accountId?: number }
  >): Promise<TriggerHistoryPage> {
    if (accountId == null) {
      throw new NordError(
        "Account ID is undefined. Make sure to call updateAccountId() before requesting trigger history.",
      );
    }

    try {
      return await this.GET("/account/{account_id}/triggers/history", {
        params: {
          path: { account_id: accountId },
          query: {
            since,
            until,
            pageSize,
            startInclusive,
          },
        },
      });
    } catch (error) {
      throw new NordError("Failed to fetch account trigger history", {
        cause: error,
      });
    }
  }

  /**
   * Fetch withdrawal history for an account.
   *
   * @param accountId - Account identifier owning the withdrawals
   * @param since - RFC3339 timestamp to start from (inclusive)
   * @param until - RFC3339 timestamp to end at (exclusive)
   * @param pageSize - Maximum number of entries to return
   * @param startInclusive - Pagination cursor to resume from
   * @throws {NordError} If no account can be resolved or the request fails.
   */
  async getAccountWithdrawalHistory({
    accountId,
    since,
    until,
    pageSize,
    startInclusive,
  }: Readonly<
    PagedQuery & { accountId?: number }
  >): Promise<WithdrawalHistoryPage> {
    if (accountId == null) {
      throw new NordError(
        "Account ID is undefined. Make sure to call updateAccountId() before requesting withdrawal history.",
      );
    }

    try {
      return await this.GET("/account/{account_id}/history/withdrawal", {
        params: {
          path: { account_id: accountId },
          query: {
            since,
            until,
            pageSize,
            startInclusive,
          },
        },
      });
    } catch (error) {
      throw new NordError("Failed to fetch account withdrawal history", {
        cause: error,
      });
    }
  }
}
