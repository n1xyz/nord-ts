import { Account, Info, SubscriptionPattern } from "../../types";
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
 * Connects to the Nord WebSocket endpoint with support for multiple subscription types:
 * - trades@SYMBOL - For trade updates
 * - deltas@SYMBOL - For orderbook delta updates
 * - account@ACCOUNT_ID - For user-specific updates
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @param subscriptions - Array of subscriptions (e.g., ["trades@BTCUSDC", "deltas@BTCUSDC", "account@42"])
 * @returns WebSocket client
 * @throws {NordError} If initialization fails or invalid subscription is provided
 */
export function initWebSocketClient(
  webServerUrl: string,
  subscriptions?: SubscriptionPattern[] | "trades" | "delta" | "account",
  initialSubscriptions?: SubscriptionPattern[],
): NordWebSocketClient {
  try {
    // Determine URL and subscriptions based on parameters
    let wsUrl = webServerUrl.replace(/^http/, "ws") + `/ws`;
    let wsSubscriptions: SubscriptionPattern[] = [];

    // Validate subscriptions parameter
    if (typeof subscriptions === "string") {
      // Legacy mode - handle endpoint string
      if (
        subscriptions === "trades" ||
        subscriptions === "delta" ||
        subscriptions === "account"
      ) {
        wsUrl += `/${subscriptions}`;
        // If initialSubscriptions provided, use them
        if (initialSubscriptions && initialSubscriptions.length > 0) {
          // Validate initialSubscriptions
          initialSubscriptions.forEach(validateSubscription);
          wsSubscriptions = initialSubscriptions;
        }
      } else {
        throw new NordError(
          `Invalid endpoint: ${subscriptions}. Must be "trades", "deltas", or "account".`,
        );
      }
    } else if (Array.isArray(subscriptions) && subscriptions.length > 0) {
      // New mode - validate and combine subscriptions in URL
      subscriptions.forEach(validateSubscription);
      wsUrl += `/${subscriptions.join("&")}`;
    } else {
      // Default to trades endpoint if no subscriptions specified
      wsUrl += `/trades`;
    }

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

      // Subscribe to additional subscriptions if provided
      // For new format, these are already part of the URL
      if (wsSubscriptions.length > 0) {
        ws.subscribe(wsSubscriptions);
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

/**
 * Validates a subscription string follows the correct format
 *
 * @param subscription - The subscription to validate
 * @throws {NordError} If the subscription format is invalid
 */
function validateSubscription(subscription: string): void {
  const [type, param] = subscription.split("@");

  if (!type || !param || !["trades", "deltas", "account"].includes(type)) {
    throw new NordError(
      `Invalid subscription format: ${subscription}. Expected format: "trades@SYMBOL", "deltas@SYMBOL", or "account@ID"`,
    );
  }

  // Additional validation for account subscriptions
  if (type === "account" && isNaN(Number(param))) {
    throw new NordError(
      `Invalid account ID in subscription: ${subscription}. Account ID must be a number.`,
    );
  }
}
