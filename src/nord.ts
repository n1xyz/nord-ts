import * as proto from "./gen/nord";
import {
  encodeDelimited,
  SESSION_TTL,
  MAX_BUFFER_LEN,
  toShiftedNumber,
  getCurrentTimestamp,
  getNonce,
  sendMessage,
  decodeDelimited,
  checkPubKeyLength,
  findMarket,
  findToken,
} from "./utils";
import {
  type CreateSessionParams,
  type DepositParams,
  type PlaceOrderParams,
  type CancelOrderParams,
  KeyType,
  Side,
  fillModeToProtoFillMode,
  type WithdrawParams,
  type ClientConfig,
  type SubsriberConfig,
  type Market,
  type Token,
  type DeltaEvent,
  type Info,
  type FillMode,
} from "./types";
import fetch from "node-fetch";
import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import WebSocket from "ws";

const assert = (pred: boolean): void => {
  if (!pred) {
    throw new Error("assertion violation");
  }
};

class CreateSessionMessage {
  url: string;
  message: Uint8Array;
  privateKey: Uint8Array;

  constructor(
    url: string,
    sessionPubkey: Uint8Array,
    userPrivateKey: Uint8Array,
    userId: number,
  ) {
    this.url = url;
    this.privateKey = userPrivateKey;

    this.message = createSession({
      userId,
      keyType: KeyType.Ed25119,
      pubkey: sessionPubkey,
      expiryTs: getCurrentTimestamp() + SESSION_TTL,
    });
  }

  async send(): Promise<number> {
    const hash = sha256(this.message);
    const signature = secp256k1.sign(hash, this.privateKey).toCompactRawBytes();
    assert(signature.length === 64);
    const body = new Uint8Array([...this.message, ...signature]);
    const resp = decodeDelimited(await sendMessage(body));
    if (resp.has_err) {
      throw new Error(`Could not create a new session, reason: ${resp.err}`);
    }

    return resp.create_session_result.session_id;
  }
}

class DepositMessage {
  url: string;
  message: Uint8Array;
  privateKey: Uint8Array;

  constructor(
    url: string,
    privateKey: Uint8Array,
    sizeDecimals: number,
    tokenId: number,
    userId: number,
    amount: number,
  ) {
    this.url = url;
    this.privateKey = privateKey;

    this.message = deposit({
      tokenId,
      userId,
      amount: toShiftedNumber(amount, sizeDecimals),
    });
  }

  async send(): Promise<void> {
    const signature = ed25519.sign(this.message, this.privateKey);
    const body = new Uint8Array([...this.message, ...signature]);
    const resp = decodeDelimited(await sendMessage(body));
    if (resp.has_err) {
      throw new Error(`Could not deposit, reason: ${resp.err}`);
    }
    // Receipt for Deposit does not implemented
  }
}

class WithdrawMessage {
  url: string;
  message: Uint8Array;
  privateKey: Uint8Array;

  constructor(
    url: string,
    privateKey: Uint8Array,
    sizeDecimals: number,
    tokenId: number,
    userId: number,
    amount: number,
  ) {
    this.url = url;
    this.privateKey = privateKey;

    this.message = withdraw({
      tokenId,
      userId,
      amount: toShiftedNumber(amount, sizeDecimals),
    });
  }

  async send(): Promise<void> {
    const signature = ed25519.sign(this.message, this.privateKey);
    const body = new Uint8Array([...this.message, ...signature]);
    const resp = decodeDelimited(await sendMessage(body));
    if (resp.has_err) {
      throw new Error(`Could not withdraw, reason: ${resp.err}`);
    }
    // Receipt for Withdraw does not implemented
  }
}

class PlaceOrderMessage {
  url: string;
  message: Uint8Array;
  privateKey: Uint8Array;

  constructor(
    url: string,
    privateKey: Uint8Array,
    sizeDecimals: number,
    priceDecimals: number,
    userId: number,
    sessionId: number,
    marketId: number,
    side: Side,
    fillMode: FillMode,
    isReduceOnly: boolean,
    size: number,
    price?: number,
  ) {
    this.url = url;
    this.privateKey = privateKey;

    this.message = placeOrder({
      userId,
      marketId,
      side,
      fillMode,
      isReduceOnly,
      price: toShiftedNumber(price ?? 0, priceDecimals),
      size: toShiftedNumber(size, sizeDecimals),
      sessionId,
    });
  }

  async send(): Promise<number> {
    const signature = ed25519.sign(this.message, this.privateKey);
    const body = new Uint8Array([...this.message, ...signature]);
    const resp = decodeDelimited(await sendMessage(body));
    if (resp.has_err) {
      throw new Error(`Could not place the order, reason: ${resp.err}`);
    }

    return resp.place_order_result.posted.order_id;
  }
}

class CancelOrderMessage {
  url: string;
  message: Uint8Array;
  privateKey: Uint8Array;

  constructor(
    url: string,
    privateKey: Uint8Array,
    userId: number,
    sessionId: number,
    marketId: number,
    orderId: number,
  ) {
    this.url = url;
    this.privateKey = privateKey;

    this.message = cancelOrder({
      userId,
      sessionId,
      marketId,
      orderId,
    });
  }

  async send(): Promise<number> {
    const signature = ed25519.sign(this.message, this.privateKey);
    const body = new Uint8Array([...this.message, ...signature]);
    const resp = decodeDelimited(await sendMessage(body));
    if (resp.has_err) {
      throw new Error(`Could not cancel the order, reason: ${resp.err}`);
    }

    return resp.cancel_order_result.order_id;
  }
}

export class Nord {
  url: string | null;
  markets: Market[];
  tokens: Token[];
  message: Uint8Array;
  signature: Uint8Array;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  userId: number;
  sessionSk: Uint8Array;
  sessionId: number;

  constructor(privateKey: NonNullable<Uint8Array>) {
    this.url = null;
    this.markets = [];
    this.tokens = [];
    this.message = new Uint8Array();
    this.signature = new Uint8Array();
    this.privateKey = privateKey;
    this.publicKey = secp256k1.getPublicKey(this.privateKey, true);
    this.userId = 0;
    this.sessionSk = new Uint8Array();
    this.sessionId = 0;

    assert(this.privateKey.length === 32);
    assert(this.publicKey.length === 33);
  }

  public static async createClient({
    url,
    privateKey,
  }: ClientConfig): Promise<Nord> {
    const nord = new Nord(privateKey);
    nord.url = url;
    const pubkeyHex = Buffer.from(nord.publicKey).toString("hex");
    const response = await fetch(`${url}/info`, { method: "GET" });
    const info: Info = await response.json();
    const userId = await fetch(`${url}/user_id?pubkey=${pubkeyHex}`)
      .then(async (r) => await r.json())
      .then((u) => Number(u));
    nord.markets = info.markets;
    nord.tokens = info.tokens;
    nord.userId = userId;

    await nord.refreshSession(nord.userId);
    return nord;
  }

  private async refreshSession(userId: number): Promise<void> {
    const sessionSk = ed25519.utils.randomPrivateKey();
    const sessionVk = ed25519.getPublicKey(sessionSk);

    assert(sessionSk.length === 32);
    assert(sessionVk.length === 32);

    const message = new CreateSessionMessage(
      `${this.url}/action`,
      sessionVk,
      this.privateKey,
      userId,
    );
    const sessionId = await message.send();

    this.sessionId = sessionId;
    this.sessionSk = sessionSk;
  }

  async deposit(tokenId: number, amount: number): Promise<void> {
    const message = new DepositMessage(
      `${this.url}/action`,
      this.privateKey,
      findToken(this.tokens, tokenId).decimals,
      tokenId,
      this.userId,
      amount,
    );

    await message.send();
  }

  async withdraw(tokenId: number, amount: number): Promise<void> {
    const message = new WithdrawMessage(
      `${this.url}/action`,
      this.privateKey,
      findToken(this.tokens, tokenId).decimals,
      tokenId,
      this.userId,
      amount,
    );

    await message.send();
  }

  async placeOrder(
    marketId: number,
    side: Side,
    fillMode: FillMode,
    isReduceOnly: boolean,
    size: number,
    price?: number,
  ): Promise<number> {
    const message = new PlaceOrderMessage(
      `${this.url}/action`,
      this.privateKey,
      findMarket(this.markets, marketId).sizeDecimals,
      findMarket(this.markets, marketId).priceDecimals,
      this.userId,
      this.sessionId,
      marketId,
      side,
      fillMode,
      isReduceOnly,
      size,
      price,
    );

    return await message.send();
  }

  async cancelOrder(marketId: number, orderId: number): Promise<number> {
    const message = new CancelOrderMessage(
      `${this.url}/action`,
      this.privateKey,
      this.userId,
      this.sessionId,
      marketId,
      orderId,
    );

    return await message.send();
  }
}

export class Subscriber {
  streamURL: string;
  buffer: DeltaEvent[];
  maxBufferLen: number;

  constructor(config: SubsriberConfig) {
    this.streamURL = config.streamURL;
    this.buffer = [];
    this.maxBufferLen = config.maxBufferLen ?? MAX_BUFFER_LEN;
  }

  subsribe(): void {
    const ws = new WebSocket(this.streamURL);

    ws.on("open", () => {
      console.log(`Connected to ${this.streamURL}`);
    });

    ws.on("message", (rawData) => {
      const message: string = rawData.toLocaleString();
      const event: DeltaEvent = JSON.parse(message);
      if (!this.checkEvent(event)) {
        return;
      }
      this.buffer.push(event);
      if (this.buffer.length > this.maxBufferLen) {
        this.buffer.shift();
      }
    });

    ws.on("close", () => {
      console.log(`Disconnected from ${this.streamURL}`);
    });
  }

  checkEvent(event: DeltaEvent): boolean {
    return true;
  }
}

/**
 * Generates a createSession action payload.
 *
 * @param params - Parameters to create a new session.
 * @param params.userId - ID of the user.
 * @param params.blstPubkey - BLS public key (must be 96 bytes).
 * @param params.expiryTs - Expiry timestamp of the session.
 * @returns Encoded message as Uint8Array.
 * @throws Will throw an error if pubkey length isn't 96 or expiry timestamp is in the past.
 */
export function createSession(params: CreateSessionParams): Uint8Array {
  checkPubKeyLength(params.keyType, params.pubkey.length);

  if (params.expiryTs <= Math.ceil(Date.now() / 1000)) {
    throw new Error("Cannot set an expiry timestamp in the past.");
  }

  const pbCreateSession = proto.nord.Action.fromObject({
    current_timestamp: getCurrentTimestamp(),
    nonce: getNonce(),
    create_session: new proto.nord.Action.CreateSession({
      user_id: params.userId,
      blst_pubkey: params.pubkey,
      expiry_timestamp: params.expiryTs,
    }),
  });

  return encodeDelimited(pbCreateSession);
}

/**
 * Generates a deposit action payload.
 *
 * @param params - Parameters for deposit.
 * @param params.tokenId - ID of the token.
 * @param params.userId - ID of the user.
 * @param params.amount - Amount to deposit.
 * @returns Encoded message as Uint8Array.
 * @throws Will throw an error if deposit amount is 0 or less.
 */
export function deposit(params: DepositParams): Uint8Array {
  // if (params.amount.lessThan(ZERO_DECIMAL)) {
  if (params.amount < 0) {
    throw new Error("Cannot deposit 0 or less.");
  }

  const pbDeposit = proto.nord.Action.fromObject({
    current_timestamp: getCurrentTimestamp(),
    nonce: getNonce(),
    deposit: new proto.nord.Action.Deposit({
      token_id: params.tokenId,
      amount: params.amount,
    }),
  });

  return encodeDelimited(pbDeposit);
}

/**
 * Generates a withdraw action payload.
 *
 * @param params - Parameters for withdrawal.
 * @param params.tokenId - ID of the token.
 * @param params.userId - ID of the user.
 * @param params.amount - Amount to withdraw.
 * @returns Encoded message as Uint8Array.
 * @throws Will throw an error if withdrawal amount is 0 or less.
 */
export function withdraw(params: WithdrawParams): Uint8Array {
  if (params.amount < 0) {
    throw new Error("Cannot withdraw 0 or less.");
  }

  const pbWithdraw = proto.nord.Action.fromObject({
    current_timestamp: getCurrentTimestamp(),
    nonce: getNonce(),
    withdraw: new proto.nord.Action.Withdraw({
      token_id: params.tokenId,
      user_id: params.userId,
      amount: params.amount,
    }),
  });

  return encodeDelimited(pbWithdraw);
}

/**
 * Generates a placeOrder action payload.
 *
 * @param params - Parameters to place an order.
 * @param params.userId - ID of the user.
 * @param params.marketId - ID of the market.
 * @param params.side - (Ask | Bid)
 * @param params.fillMode - (Limit | PostOnly | ImmediateOrCancel | FillOrKill)
 * @param params.isReduceOnly - If the order is reduce-only.
 * @param params.price - Price of the order (optional) (Decimal).
 * @param params.size - Size of the order (Decimal).
 * @param params.sessionId - ID of the session.
 * @returns Encoded message as Uint8Array.
 * @throws Will throw an error if order price or size is 0.
 */
export function placeOrder(params: PlaceOrderParams): Uint8Array {
  if (params.price !== undefined && params.price < 0) {
    throw new Error("Cannot use 0 price for order.");
  }

  if (params.size !== undefined && params.size < 0) {
    throw new Error("Cannot use 0 size for order.");
  }

  const pbPlaceOrder = proto.nord.Action.fromObject({
    current_timestamp: getCurrentTimestamp(),
    nonce: getNonce(),
    place_order: new proto.nord.Action.PlaceOrder({
      market_id: params.marketId,
      side:
        params.side === Side.Bid ? proto.nord.Side.BID : proto.nord.Side.ASK,
      fill_mode: fillModeToProtoFillMode(params.fillMode),
      is_reduce_only: params.isReduceOnly,
      price: params.price,
      size: params.size,
      session_id: params.sessionId,
    }),
  });

  return encodeDelimited(pbPlaceOrder);
}

/**
 * Generates a cancelOrderById action payload.
 *
 * @param params - Parameters to cancel an order.
 * @param params.marketId - ID of the market.
 * @param params.userId - ID of the user.
 * @param params.orderId - ID of the order to be canceled.
 * @param params.sessionId - ID of the session.
 * @returns Encoded message as Uint8Array.
 */
export function cancelOrder(params: CancelOrderParams): Uint8Array {
  const pbCancelOrder = proto.nord.Action.fromObject({
    current_timestamp: getCurrentTimestamp(),
    nonce: getNonce(),
    cancel_order_by_id: new proto.nord.Action.CancelOrderById({
      order_id: params.orderId,
      session_id: params.sessionId,
    }),
  });
  return encodeDelimited(pbCancelOrder);
}
