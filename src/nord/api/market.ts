import {
  MarketsStatsResponse,
  OrderbookQuery,
  OrderbookResponse,
  TradesQuery,
  TradesResponse,
  UserAccountIdsQuery,
  UserAccountIdsResponse,
} from "../../types";
import { checkedFetch } from "../../utils";
import { NordError } from "../utils/NordError";

/**
 * Get market statistics
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @returns Market statistics response
 * @throws {NordError} If the request fails
 */
export async function marketsStats(
  webServerUrl: string,
): Promise<MarketsStatsResponse> {
  try {
    const response = await checkedFetch(`${webServerUrl}/stats`);
    return await response.json();
  } catch (error) {
    throw new NordError("Failed to fetch markets stats", { cause: error });
  }
}

/**
 * Get trades for a market
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @param query - Trades query parameters
 * @returns Trades response
 * @throws {NordError} If the request fails
 */
export async function getTrades(
  webServerUrl: string,
  query: TradesQuery,
): Promise<TradesResponse> {
  try {
    const params = new URLSearchParams();
    params.append("accountId", query.accountId.toString());

    if (query.since) {
      params.append("since", query.since);
    }

    if (query.until) {
      params.append("until", query.until);
    }

    if (query.pageId) {
      params.append("pageId", query.pageId);
    }

    const response = await checkedFetch(
      `${webServerUrl}/trades?${params.toString()}`,
    );
    return await response.json();
  } catch (error) {
    throw new NordError("Failed to get trades", { cause: error });
  }
}

/**
 * Get user account IDs
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @param query - User account IDs query parameters
 * @returns User account IDs response
 * @throws {NordError} If the request fails
 */
export async function getUserAccountIds(
  webServerUrl: string,
  query: UserAccountIdsQuery,
): Promise<UserAccountIdsResponse> {
  try {
    const params = new URLSearchParams();
    params.append("pubkey", query.pubkey);

    const response = await checkedFetch(
      `${webServerUrl}/user?${params.toString()}`,
    );
    return await response.json();
  } catch (error) {
    throw new NordError("Failed to get user account IDs", { cause: error });
  }
}

/**
 * Get orderbook for a market
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @param query - Orderbook query parameters
 * @returns Orderbook response
 * @throws {NordError} If the request fails
 */
export async function getOrderbook(
  webServerUrl: string,
  query: OrderbookQuery,
): Promise<OrderbookResponse> {
  try {
    const params = new URLSearchParams();

    if (query.symbol) {
      params.append("symbol", query.symbol);
    } else if (query.market_id !== undefined) {
      params.append("market_id", query.market_id.toString());
    } else {
      throw new NordError(
        "Either symbol or market_id must be provided for orderbook query",
      );
    }

    const response = await checkedFetch(
      `${webServerUrl}/orderbook?${params.toString()}`,
    );
    return await response.json();
  } catch (error) {
    throw new NordError("Failed to get orderbook", { cause: error });
  }
}
