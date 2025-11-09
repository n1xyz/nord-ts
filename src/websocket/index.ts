import { NordWebSocketClient } from "./NordWebSocketClient";
import { NordError } from "../error";
import type { SubscriptionPattern } from "../types";
import type { NordWebSocketEvents, NordWebSocketClientEvents } from "./events";
import { Subscriber } from "./Subscriber";

export {
  NordWebSocketClient,
  NordWebSocketEvents,
  NordWebSocketClientEvents,
  Subscriber,
};

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
): NordWebSocketClient {
  try {
    // Determine URL and subscriptions based on parameters
    let wsUrl = webServerUrl.replace(/^http/, "ws") + `/ws`;

    // Validate subscriptions parameter
    if (typeof subscriptions === "string") {
      // Legacy mode - handle endpoint string
      if (
        subscriptions === "trades" ||
        subscriptions === "delta" ||
        subscriptions === "account"
      ) {
        wsUrl += `/${subscriptions}`;
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
