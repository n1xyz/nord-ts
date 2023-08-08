import * as proto from "./gen/action";
import {
  encodeDelimited,
  toPbDecimal,
  ZERO_DECIMAL,
  createAction,
} from "./utils";
import {
  CreateUserParams,
  CreateSessionParams,
  DepositParams,
  PlaceOrderParams,
  CancelOrderParams,
  KeyType,
  Side,
  fillModeToProtoFillMode,
  WithdrawParams,
  ActionKind,
  ActionKindTag,
} from "./types";

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
  if (params.keyType === KeyType.Bls12_381) {
    throw new Error(
      "Cannot create a user using Bls12_381, use (Ed25119 | Secp256k1) instead."
    );
  }

  if (
    (params.pubkey.length !== 32 && params.keyType === KeyType.Ed25119) ||
    (params.pubkey.length !== 33 && params.keyType === KeyType.Secp256k1)
  ) {
    throw new Error("(Ed25119 | Secp256k1) pubkeys must be (32 | 33) length.");
  }

  const pbCreateUser: ActionKind = {
    keyType:
      params.keyType === KeyType.Ed25119
        ? proto.Action_KeyType.ED25119
        : proto.Action_KeyType.SECP256K1,
    pubkey: params.pubkey,
    tag: ActionKindTag.CreateUser,
  };

  return encodeDelimited(createAction(pbCreateUser));
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
  if (params.blstPubkey.length !== 96) {
    throw new Error("BLST Pubkey must be 96 bytes.");
  }

  if (params.expiryTs <= Math.ceil(Date.now() / 1000)) {
    throw new Error("Cannot set an expiry timestamp in the past.");
  }

  const pbCreateSession: ActionKind = {
    userId: params.userId,
    blstPubkey: params.blstPubkey,
    expiryTimestamp: params.expiryTs,
    tag: ActionKindTag.CreateSession,
  };

  return encodeDelimited(createAction(pbCreateSession));
}

/**
 * Generates a deposit action payload.
 *
 * @param params - Parameters for deposit.
 * @param params.collateralId - ID of the collateral.
 * @param params.userId - ID of the user.
 * @param params.amount - Amount to deposit.
 * @returns Encoded message as Uint8Array.
 * @throws Will throw an error if deposit amount is 0 or less.
 */
export function deposit(params: DepositParams): Uint8Array {
  if (params.amount.lessThan(ZERO_DECIMAL)) {
    throw new Error("Cannot deposit 0 or less.");
  }

  const pbDeposit: ActionKind = {
    collateralId: params.collateralId,
    userId: params.userId,
    amount: toPbDecimal(params.amount),
    tag: ActionKindTag.Deposit,
  };

  return encodeDelimited(createAction(pbDeposit));
}

/**
 * Generates a withdraw action payload.
 *
 * @param params - Parameters for withdrawal.
 * @param params.collateralId - ID of the collateral.
 * @param params.userId - ID of the user.
 * @param params.amount - Amount to withdraw.
 * @returns Encoded message as Uint8Array.
 * @throws Will throw an error if withdrawal amount is 0 or less.
 */
export function withdraw(params: WithdrawParams) {
  if (params.amount.lessThan(ZERO_DECIMAL)) {
    throw new Error("Cannot withdraw 0 or less.");
  }

  const pbWithdraw: ActionKind = {
    collateralId: params.collateralId,
    userId: params.userId,
    amount: toPbDecimal(params.amount),
    tag: ActionKindTag.Withdraw,
  };

  return encodeDelimited(createAction(pbWithdraw));
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
  if (params.price !== undefined && params.price.lessThan(ZERO_DECIMAL)) {
    throw new Error("Cannot use 0 price for order.");
  }

  if (params.size !== undefined && params.size.lessThan(ZERO_DECIMAL)) {
    throw new Error("Cannot use 0 size for order.");
  }

  const pbPlaceOrder: ActionKind = {
    userId: params.userId,
    marketId: params.marketId,
    side:
      params.side === Side.Bid ? proto.Action_Side.BID : proto.Action_Side.ASK,
    fillMode: fillModeToProtoFillMode(params.fillMode),
    isReduceOnly: params.isReduceOnly,
    price: params.price ? toPbDecimal(params.price) : undefined,
    size: toPbDecimal(params.size),
    sessionId: params.sessionId,
    tag: ActionKindTag.PlaceOrder,
  };

  return encodeDelimited(createAction(pbPlaceOrder));
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
  const pbCancelOrder: ActionKind = {
    marketId: params.marketId,
    userId: params.userId,
    orderId: params.orderId,
    sessionId: params.sessionId,
    tag: ActionKindTag.CancelOrderById,
  };

  return encodeDelimited(createAction(pbCancelOrder));
}
