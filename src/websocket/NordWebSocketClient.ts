import WebSocket from "ws";
import { EventEmitter } from "events";
import {
  WebSocketMessage,
  WebSocketMessageType,
  WebSocketSubscription,
  WebSocketTradeUpdate,
  WebSocketDeltaUpdate,
  WebSocketUserUpdate,
} from "../types";
import { NordWebSocketClientEvents } from "./events";

// Define a type that works for both Node.js ws and browser WebSocket
type BrowserWebSocket = {
  OPEN: number;
  CONNECTING: number;
  CLOSING: number;
  CLOSED: number;
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  onopen: ((this: any, ev: any) => any) | null;
  onmessage: ((this: any, ev: { data: any }) => any) | null;
  onclose: ((this: any, ev: any) => any) | null;
  onerror: ((this: any, ev: any) => any) | null;
};

type WebSocketInstance = WebSocket | BrowserWebSocket;

const VALID_STREAM_TYPES = ["trades", "deltas", "user"];

// Constants for WebSocket readyState
const WS_OPEN = 1;

/**
 * WebSocket client for Nord exchange
 *
 * This client connects to one of the specific Nord WebSocket endpoints:
 * - /ws/trades - For trade updates
 * - /ws/deltas - For orderbook delta updates
 * - /ws/user - For user-specific updates
 *
 * Each endpoint handles a specific type of data and subscriptions must match
 * the endpoint type (e.g., only 'trades@BTCUSDC' subscriptions are valid on
 * the /ws/trades endpoint).
 */
export class NordWebSocketClient
  extends EventEmitter
  implements NordWebSocketClientEvents
{
  private ws: WebSocketInstance | null = null;
  private url: string;
  private subscriptions: Set<string> = new Set();
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private pingInterval: NodeJS.Timeout | null = null;
  private pingTimeout: NodeJS.Timeout | null = null;
  private isBrowser: boolean;

  /**
   * Create a new NordWebSocketClient
   * @param url WebSocket server URL
   */
  constructor(url: string) {
    super();
    this.url = url;
    // Check if we're in a browser environment
    // The most reliable way is to check for Node.js process
    this.isBrowser =
      typeof process === "undefined" ||
      !process.versions ||
      !process.versions.node;
  }

  /**
   * Validate stream format
   * @param stream Stream identifier to validate
   * @throws Error if stream format is invalid
   */
  private validateStream(stream: string): void {
    const [type, params] = stream.split("@");

    if (!type || !params) {
      throw new Error(
        `Invalid stream format: ${stream}. Expected format: <type>@<params>`,
      );
    }

    // Extract the endpoint from the URL
    const urlPath = new URL(this.url).pathname;
    const endpoint = urlPath.split("/").pop();

    // Ensure the stream type matches the endpoint we're connected to
    if (endpoint && type !== endpoint) {
      throw new Error(
        `Stream type '${type}' doesn't match the connected endpoint '${endpoint}'`,
      );
    }

    if (!VALID_STREAM_TYPES.includes(type)) {
      throw new Error(
        `Invalid stream type: ${type}. Valid types are: ${VALID_STREAM_TYPES.join(", ")}`,
      );
    }

    if (type === "user" && !/^\d+$/.test(params)) {
      throw new Error(
        `Invalid user ID in stream: ${params}. Expected numeric ID`,
      );
    }
  }

  /**
   * Setup WebSocket ping/pong heartbeat
   */
  private setupHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
    }

    // In browser, we rely on the browser's WebSocket implementation to handle ping/pong
    if (this.isBrowser) {
      return;
    }

    this.pingInterval = setInterval(() => {
      if (this.ws && !this.isBrowser) {
        // Only use ping() method in Node.js environment
        (this.ws as WebSocket).ping();

        // Set timeout for pong response
        this.pingTimeout = setTimeout(() => {
          this.emit("error", new Error("WebSocket ping timeout"));
          this.close();
          this.reconnect();
        }, 5000); // 5 second timeout
      }
    }, 30000); // Send ping every 30 seconds
  }

  /**
   * Get the appropriate WebSocket class based on environment
   */
  private getWebSocketClass(): any {
    if (this.isBrowser) {
      // In browser environments
      // @ts-expect-error - Check for WebSocket in globalThis
      if (typeof globalThis !== "undefined" && globalThis.WebSocket) {
        // @ts-expect-error - Return WebSocket from globalThis
        return globalThis.WebSocket;
      }
      throw new Error("WebSocket is not available in this environment");
    } else {
      // In Node.js
      return WebSocket;
    }
  }

  /**
   * Connect to the Nord WebSocket server
   */
  public connect(): void {
    if (this.ws) {
      return;
    }

    try {
      const WebSocketClass = this.getWebSocketClass();

      if (this.isBrowser) {
        // Browser WebSocket setup
        this.ws = new WebSocketClass(this.url) as BrowserWebSocket;

        (this.ws as BrowserWebSocket).onopen = () => {
          this.emit("connected");
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;

          // Resubscribe to previous subscriptions
          if (this.subscriptions.size > 0) {
            this.subscribe([...this.subscriptions]);
          }
        };

        (this.ws as BrowserWebSocket).onmessage = (event: { data: any }) => {
          try {
            const message = JSON.parse(
              event.data as string,
            ) as WebSocketMessage;
            this.handleMessage(message);
          } catch (error) {
            this.emit(
              "error",
              new Error(
                `Failed to parse message: ${error instanceof Error ? error.message : String(error)}`,
              ),
            );
          }
        };

        (this.ws as BrowserWebSocket).onclose = (event: any) => {
          const reason =
            event && event.reason ? ` Reason: ${event.reason}` : "";
          const code = event && event.code ? ` Code: ${event.code}` : "";
          this.emit("disconnected");
          console.log(`WebSocket closed.${code}${reason}`);
          this.reconnect();
        };

        (this.ws as BrowserWebSocket).onerror = (event: any) => {
          const errorMsg = `WebSocket error: ${event && event.type ? event.type : "unknown"}`;
          console.error(errorMsg, event);
          this.emit("error", new Error(errorMsg));
        };
      } else {
        // Node.js WebSocket setup
        const nodeWs = new WebSocketClass(this.url) as WebSocket;
        this.ws = nodeWs;

        nodeWs.on("open", () => {
          this.emit("connected");
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          this.setupHeartbeat();

          // Resubscribe to previous subscriptions
          if (this.subscriptions.size > 0) {
            this.subscribe([...this.subscriptions]);
          }
        });

        nodeWs.on("message", (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString()) as WebSocketMessage;
            this.handleMessage(message);
          } catch (error) {
            this.emit(
              "error",
              new Error(
                `Failed to parse message: ${error instanceof Error ? error.message : String(error)}`,
              ),
            );
          }
        });

        nodeWs.on("close", (code: number, reason: string) => {
          this.emit("disconnected");
          console.log(`WebSocket closed. Code: ${code} Reason: ${reason}`);
          if (this.pingInterval) {
            clearInterval(this.pingInterval);
          }
          if (this.pingTimeout) {
            clearTimeout(this.pingTimeout);
          }
          this.reconnect();
        });

        nodeWs.on("error", (error: Error) => {
          console.error("WebSocket error:", error);
          this.emit("error", error);
        });

        nodeWs.on("pong", () => {
          if (this.pingTimeout) {
            clearTimeout(this.pingTimeout);
          }
        });
      }
    } catch (error) {
      const errorMsg = `Failed to initialize WebSocket: ${error instanceof Error ? error.message : String(error)}`;
      console.error(errorMsg);
      this.emit("error", new Error(errorMsg));
    }
  }

  /**
   * Subscribe to one or more streams
   * @param streams Array of streams to subscribe to (e.g. ["trades@BTCUSDC", "deltas@BTCUSDC"])
   */
  public subscribe(streams: string[]): void {
    // Validate all streams first
    try {
      streams.forEach((stream) => this.validateStream(stream));
    } catch (error) {
      this.emit(
        "error",
        error instanceof Error ? error : new Error(String(error)),
      );
      return;
    }

    if (
      !this.ws ||
      (this.isBrowser
        ? (this.ws as BrowserWebSocket).readyState !== WS_OPEN
        : (this.ws as WebSocket).readyState !== WebSocket.OPEN)
    ) {
      streams.forEach((stream) => this.subscriptions.add(stream));
      return;
    }

    const message: WebSocketSubscription = {
      type: WebSocketMessageType.Subscribe,
      streams,
    };

    try {
      const messageStr = JSON.stringify(message);
      if (this.isBrowser) {
        (this.ws as BrowserWebSocket).send(messageStr);
      } else {
        (this.ws as WebSocket).send(messageStr);
      }
      streams.forEach((stream) => this.subscriptions.add(stream));
    } catch (error) {
      this.emit(
        "error",
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Unsubscribe from one or more streams
   * @param streams Array of streams to unsubscribe from
   */
  public unsubscribe(streams: string[]): void {
    // Validate all streams first
    try {
      streams.forEach((stream) => this.validateStream(stream));
    } catch (error) {
      this.emit(
        "error",
        error instanceof Error ? error : new Error(String(error)),
      );
      return;
    }

    if (
      !this.ws ||
      (this.isBrowser
        ? (this.ws as BrowserWebSocket).readyState !== WS_OPEN
        : (this.ws as WebSocket).readyState !== WebSocket.OPEN)
    ) {
      streams.forEach((stream) => this.subscriptions.delete(stream));
      return;
    }

    const message: WebSocketSubscription = {
      type: WebSocketMessageType.Unsubscribe,
      streams,
    };

    try {
      const messageStr = JSON.stringify(message);
      if (this.isBrowser) {
        (this.ws as BrowserWebSocket).send(messageStr);
      } else {
        (this.ws as WebSocket).send(messageStr);
      }
      streams.forEach((stream) => this.subscriptions.delete(stream));
    } catch (error) {
      this.emit(
        "error",
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Close the WebSocket connection
   */
  public close(): void {
    if (this.ws) {
      if (this.isBrowser) {
        (this.ws as BrowserWebSocket).close();
      } else {
        (this.ws as WebSocket).close();
      }
      this.ws = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
    }
    this.subscriptions.clear();
  }

  /**
   * Handle incoming WebSocket messages
   * @param message WebSocket message
   */
  private handleMessage(message: WebSocketMessage): void {
    switch (message.type) {
      case WebSocketMessageType.TradeUpdate:
        this.emit("trade", message as WebSocketTradeUpdate);
        break;
      case WebSocketMessageType.DeltaUpdate:
        this.emit("delta", message as WebSocketDeltaUpdate);
        break;
      case WebSocketMessageType.UserUpdate:
        this.emit("user", message as WebSocketUserUpdate);
        break;
      default:
        this.emit("error", new Error(`Unknown message type: ${message.type}`));
    }
  }

  /**
   * Attempt to reconnect to the WebSocket server
   */
  private reconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit("error", new Error("Max reconnection attempts reached"));
      return;
    }

    setTimeout(() => {
      this.reconnectAttempts++;
      this.reconnectDelay *= 2; // Exponential backoff
      this.connect();
    }, this.reconnectDelay);
  }
}
