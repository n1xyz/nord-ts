import * as proto from "./gen/nord";
import {
  encodeDelimited,
  SESSION_TTL,
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
  type CreateUserParams,
  type CreateSessionParams,
  type DepositParams,
  type PlaceOrderParams,
  type CancelOrderParams,
  KeyType,
  Side,
  fillModeToProtoFillMode,
  type WithdrawParams,
  type NordConfig,
  type Market,
  type FillMode,
  type Token,
} from "./types";
import fetch from "node-fetch";
import { ed25519 } from "@noble/curves/ed25519";

class CreateUserMessage {
  url: string;
  message: Uint8Array;
  privateKey: Uint8Array;

  constructor(url: string, publicKey: Uint8Array, privateKey: Uint8Array) {
    this.url = url;
    this.privateKey = privateKey;

    this.message = createUser({
      keyType: KeyType.Ed25119,
      pubkey: publicKey,
    });
  }

  async send(): Promise<number> {
    const signature = ed25519.sign(this.message, this.privateKey);
    const body = new Uint8Array([...this.message, ...signature]);
    const resp = await sendMessage(body);
    return decodeDelimited(resp).create_user_result.user_id;
  }
}

class CreateSessionMessage {
  url: string;
  message: Uint8Array;
  privateKey: Uint8Array;

  constructor(
    url: string,
    publicKey: Uint8Array,
    privateKey: Uint8Array,
    userId: number,
  ) {
    this.url = url;
    this.privateKey = privateKey;

    this.message = createSession({
      userId,
      keyType: KeyType.Ed25119,
      pubkey: publicKey,
      expiryTs: getCurrentTimestamp() + SESSION_TTL,
    });
  }

  async send(): Promise<number> {
    const signature = ed25519.sign(this.message, this.privateKey);
    const body = new Uint8Array([...this.message, ...signature]);
    const resp = await sendMessage(body);
    return decodeDelimited(resp).create_session_result.session_id;
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
    await sendMessage(body);
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
    await sendMessage(body);
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
    const resp = await sendMessage(body);
    return decodeDelimited(resp).place_order_result.posted.order_id;
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
    const resp = await sendMessage(body);
    return decodeDelimited(resp).cancel_order_result.cancelled.order_id;
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
  sessionId: number;

  constructor(privateKey: NonNullable<Uint8Array>) {
    this.url = null;
    this.markets = [];
    this.tokens = [];
    this.message = new Uint8Array();
    this.signature = new Uint8Array();
    this.privateKey = privateKey;
    this.publicKey = ed25519.getPublicKey(this.privateKey);
    this.userId = 0;
    this.sessionId = 0;
  }

  public static async createClient(config: NordConfig): Promise<Nord> {
    let privateKey = config.privateKey;
    if (privateKey === undefined) {
      privateKey = ed25519.utils.randomPrivateKey();
    }
    const nord = new Nord(privateKey);
    nord.url = config.url;
    let response = await fetch(`${config.url}/markets`, { method: "GET" });
    nord.markets = await response.json();
    response = await fetch(`${config.url}/tokens`, { method: "GET" });
    nord.tokens = await response.json();
    nord.userId = await nord.createUser();
    nord.sessionId = await nord.createSession(nord.userId);
    return nord;
  }

  private async createUser(): Promise<number> {
    const message = new CreateUserMessage(
      `${this.url}/action`,
      this.publicKey,
      this.privateKey,
    );

    return await message.send();
  }

  private async createSession(userId: number): Promise<number> {
    const message = new CreateSessionMessage(
      `${this.url}/action`,
      this.publicKey,
      this.privateKey,
      userId,
    );

    return await message.send();
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
      findMarket(this.markets, marketId).size_decimals,
      findMarket(this.markets, marketId).price_decimals,
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

/**
 * Generates a createUser action payload.
 *
 * @param params - Parameters to create a new user.
 * @param params.keyType - The cryptographic key type.
 * @param params.pubkey - The public key of the user.
 * @returns Encoded message as Uint8Array.
 * @throws Will throw an error if using unsupported key type or invalid pubkey length.
 */
export function createUser(params: CreateUserParams): Uint8Array {
  checkPubKeyLength(params.keyType, params.pubkey.length);

  const pbCreateUser = proto.nord.Action.fromObject({
    current_timestamp: getCurrentTimestamp(),
    nonce: getNonce(),
    create_user: new proto.nord.Action.CreateUser({
      key_type:
        params.keyType === KeyType.Ed25119
          ? proto.nord.KeyType.ED25119
          : proto.nord.KeyType.SECP256K1,
      pubkey: params.pubkey,
    }),
  });

  return encodeDelimited(pbCreateUser);
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
      collateral_id: params.tokenId,
      user_id: params.userId,
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
      collateral_id: params.tokenId,
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
