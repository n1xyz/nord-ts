import { Account, Info } from "../../types";
import { checkedFetch } from "../../utils";
import { NordWebSocketClient } from "../../websocket/index";
import { NordError } from "../utils/NordError";

/**
 * Get the current timestamp from the Nord server
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @returns Current timestamp as a bigint
 * @throws {NordError} If the request fails
 */
export async function getTimestamp(webServerUrl: string): Promise<bigint> {
  try {
    const response = await checkedFetch(`${webServerUrl}/timestamp`);
    return BigInt(await response.json());
  } catch (error) {
    throw new NordError("Failed to get timestamp", { cause: error });
  }
}

/**
 * Get the next action nonce from the Nord server
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @returns Next action nonce
 * @throws {NordError} If the request fails
 */
export async function getActionNonce(webServerUrl: string): Promise<number> {
  try {
    const response = await checkedFetch(`${webServerUrl}/action_nonce`);
    const data = await response.json();
    return data.nonce;
  } catch (error) {
    throw new NordError("Failed to get action nonce", { cause: error });
  }
}

/**
 * Get information about the Nord server
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @returns Information about markets and tokens
 * @throws {NordError} If the request fails
 */
export async function getInfo(webServerUrl: string): Promise<Info> {
  try {
    const response = await checkedFetch(`${webServerUrl}/info`);
    return await response.json();
  } catch (error) {
    throw new NordError("Failed to get info", { cause: error });
  }
}

/**
 * Get account information
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @param accountId - Account ID to get information for
 * @returns Account information
 * @throws {NordError} If the request fails
 */
export async function getAccount(
  webServerUrl: string,
  accountId: number,
): Promise<Account> {
  try {
    const response = await checkedFetch(`${webServerUrl}/account/${accountId}`);
    return await response.json();
  } catch (error) {
    throw new NordError(`Failed to get account ${accountId}`, { cause: error });
  }
}

/**
 * Initialize a WebSocket client for Nord
 *
 * Connects to one of the specific Nord WebSocket endpoints:
 * - /ws/trades - For trade updates (default)
 * - /ws/deltas - For orderbook delta updates
 * - /ws/user - For user-specific updates
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @param endpoint - Specific WebSocket endpoint to connect to (trades, deltas, or user)
 * @param initialSubscriptions - Optional array of initial subscriptions (e.g., ["trades@BTCUSDC"])
 * @returns WebSocket client
 */
export function initWebSocketClient(
  webServerUrl: string,
  endpoint?: "trades" | "deltas" | "user",
  initialSubscriptions?: string[],
): NordWebSocketClient {
  try {
    // Convert HTTP URL to WebSocket URL with specific endpoint
    // If no specific endpoint is provided, we'll connect to trades by default
    const specificEndpoint = endpoint || "trades";
    const wsUrl =
      webServerUrl.replace(/^http/, "ws") + `/ws/${specificEndpoint}`;
    console.log(`Initializing WebSocket client with URL: ${wsUrl}`);

    // Create and connect the WebSocket client
    const ws = new NordWebSocketClient(wsUrl);

    // Add error handler
    ws.on("error", (error) => {
      console.error("Nord WebSocket error:", error);
    });

    // Add connected handler for debugging
    ws.on("connected", () => {
      console.log("Nord WebSocket connected successfully");

      // Subscribe to initial subscriptions if provided
      if (initialSubscriptions && initialSubscriptions.length > 0) {
        ws.subscribe(initialSubscriptions);
      }
    });

    // Connect the WebSocket
    ws.connect();
    return ws;
  } catch (error) {
    console.error("Failed to initialize WebSocket client:", error);
    throw new NordError("Failed to initialize WebSocket client", {
      cause: error,
    });
  }
}
