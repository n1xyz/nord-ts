import { EventEmitter } from "events";
import {
  Account,
  DeltaEvent,
  OrderbookResponse,
  SubscriberConfig,
  StreamTrade,
  Trades,
} from "../types";
import { MAX_BUFFER_LEN } from "../utils";

/**
 * Subscriber class for handling WebSocket subscriptions
 */
export class Subscriber {
  streamURL: string;
  buffer: (DeltaEvent | Trades | Account)[];
  maxBufferLen: number;

  /**
   * Create a new Subscriber instance
   * @param config Subscriber configuration
   */
  constructor(config: SubscriberConfig) {
    this.streamURL = config.streamURL;
    this.buffer = [];
    this.maxBufferLen = config.maxBufferLen ?? MAX_BUFFER_LEN;
  }

  /**
   * Subscribe to WebSocket events
   */
  subscribe(): void {
    // TODO: Implement subscription logic
  }
}

/**
 * Interface for orderbook subscription
 */
export interface OrderbookSubscription extends EventEmitter {
  on(event: "message", listener: (data: OrderbookResponse) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  close(): void;
  removeAllListeners(event?: string): this;
}

/**
 * Interface for trade subscription
 */
export interface TradeSubscription extends EventEmitter {
  on(event: "message", listener: (data: StreamTrade[]) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  close(): void;
  removeAllListeners(event?: string): this;
}
