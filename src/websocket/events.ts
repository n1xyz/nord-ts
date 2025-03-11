import {
  WebSocketTradeUpdate,
  WebSocketDeltaUpdate,
  WebSocketUserUpdate,
} from "../types";

/**
 * Event type definitions for the NordWebSocketClient
 */
export interface NordWebSocketEvents {
  connected: () => void;
  disconnected: () => void;
  error: (error: Error) => void;
  trade: (update: WebSocketTradeUpdate) => void;
  delta: (update: WebSocketDeltaUpdate) => void;
  user: (update: WebSocketUserUpdate) => void;
}

/**
 * Type declaration for NordWebSocketClient event methods
 */
export declare interface NordWebSocketClientEvents {
  on<E extends keyof NordWebSocketEvents>(
    event: E,
    listener: NordWebSocketEvents[E],
  ): this;
  emit<E extends keyof NordWebSocketEvents>(
    event: E,
    ...args: Parameters<NordWebSocketEvents[E]>
  ): boolean;
}
