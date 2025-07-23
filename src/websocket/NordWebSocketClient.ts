import { EventEmitter } from "events";
import WebSocket from "ws";
import {
  WebSocketAccountUpdate,
  WebSocketDeltaUpdate,
  WebSocketMessage,
  WebSocketTradeUpdate,
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

const VALID_STREAM_TYPES = ["trades", "delta", "account"];

/**
 * WebSocket client for Nord exchange
 *
 * This client connects to one of the specific Nord WebSocket endpoints:
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

    if (type === "account" && !/^\d+$/.test(params)) {
      throw new Error(
        `Invalid account ID in stream: ${params}. Expected numeric ID`,
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
      if (typeof globalThis !== "undefined" && globalThis.WebSocket) {
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

        (this.ws as BrowserWebSocket).onclose = (_event: any) => {
          this.emit("disconnected");
          this.reconnect();
        };

        (this.ws as BrowserWebSocket).onerror = (event: any) => {
          const errorMsg = `WebSocket error: ${event && event.type ? event.type : "unknown"}`;
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

        nodeWs.on("close", (_code: number, _reason: string) => {
          this.emit("disconnected");
          if (this.pingInterval) {
            clearInterval(this.pingInterval);
          }
          if (this.pingTimeout) {
            clearTimeout(this.pingTimeout);
          }
          this.reconnect();
        });

        nodeWs.on("error", (error: Error) => {
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
      this.emit("error", new Error(errorMsg));
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
  }

  /**
   * Handle incoming WebSocket messages
   * @param message WebSocket message
   */
  private handleMessage(message: WebSocketMessage): void {
    if (!message || typeof message !== "object") {
      this.emit("error", new Error(`Unexpected message type: ${message}`));
      return;
    }

    const hasOwn = (k: string) =>
      Object.prototype.hasOwnProperty.call(message, k);
    if (hasOwn("trades")) {
      this.emit("trades", message as WebSocketTradeUpdate);
      return;
    }
    if (hasOwn("delta")) {
      this.emit("delta", message as WebSocketDeltaUpdate);
      return;
    }
    if (hasOwn("account")) {
      this.emit("account", message as WebSocketAccountUpdate);
      return;
    }

    this.emit("error", new Error(`Unexpected message type: ${message}`));
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
