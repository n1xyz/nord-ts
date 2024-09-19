import { ethers } from "ethers";
import { FillMode, fillModeToProtoFillMode, KeyType, Side } from "../types";
import {
  assert,
  bigIntToProtoU128,
  BigIntValue,
  checkedFetch,
  checkPubKeyLength,
  decodeLengthDelimited,
  encodeLengthDelimited,
  getCurrentTimestamp,
  optMap,
  SESSION_TTL,
  toScaledU128,
  toScaledU64,
} from "../utils";
import * as proto from "../gen/nord";
import Decimal from "decimal.js";

async function sessionSign(
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  message: Uint8Array,
): Promise<Uint8Array> {
  const signature = await signFn(message);
  return new Uint8Array([...message, ...signature]);
}

async function walletSign(
  walletSignFn: (message: string | Uint8Array) => Promise<string>,
  message: Uint8Array,
): Promise<Uint8Array> {
  const signature = await walletSignFn(message);
  return new Uint8Array([
    ...message,
    ...ethers.getBytes(signature.slice(0, -2)),
  ]);
}

function makeSendHttp(
  serverUrl: string,
): (encoded: Uint8Array) => Promise<Uint8Array> {
  return async (body) => {
    const response = await checkedFetch(`${serverUrl}/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    });
    return new Uint8Array(await response.arrayBuffer());
  };
}

async function sendAction(
  sendFn: (encoded: Uint8Array) => Promise<Uint8Array>,
  makeSignedMessage: (message: Uint8Array) => Promise<Uint8Array>,
  action: proto.Action,
  actionErrorDesc: string,
): Promise<proto.Receipt> {
  const encoded = encodeLengthDelimited(action, proto.Action);
  const body = await makeSignedMessage(encoded);
  const rawResp = await sendFn(body);
  const resp: proto.Receipt = decodeLengthDelimited(rawResp, proto.Receipt);

  if (resp.kind?.$case === "err") {
    throw new Error(
      `Could not ${actionErrorDesc}, reason: ${proto.errorToJSON(resp.kind.value)}`,
    );
  }

  return resp;
}

async function createSessionImpl(
  sendFn: (encoded: Uint8Array) => Promise<Uint8Array>,
  walletSignFn: (message: string | Uint8Array) => Promise<string>,
  nonce: number,
  params: {
    userPubkey: Uint8Array;
    sessionPubkey: Uint8Array;
    // If not specified, set to current moment plus default session TTL
    expiryTimestamp?: number;
  },
): Promise<bigint> {
  checkPubKeyLength(KeyType.Secp256k1, params.userPubkey.length);
  checkPubKeyLength(KeyType.Ed25519, params.sessionPubkey.length);

  const now = getCurrentTimestamp();
  let expiry = 0;

  if (params.expiryTimestamp !== undefined) {
    expiry = params.expiryTimestamp as number;
    assert(
      expiry > Math.ceil(Date.now() / 1000),
      "Cannot set expiry timestamp in the past",
    );
  } else {
    expiry = now + SESSION_TTL;
  }

  const action: proto.Action = {
    currentTimestamp: BigInt(now),
    nonce,
    kind: {
      $case: "createSession",
      value: {
        userPubkey: params.userPubkey,
        blstPubkey: params.sessionPubkey,
        expiryTimestamp: BigInt(expiry),
      },
    },
  };

  const resp = await sendAction(
    sendFn,
    (m) => walletSign(walletSignFn, m),
    action,
    "create a new session",
  );

  if (resp.kind?.$case === "createSessionResult") {
    return resp.kind.value.sessionId;
  } else {
    throw new Error(`Unexpected receipt kind ${resp.kind?.$case}`);
  }
}

export async function createSession(
  serverUrl: string,
  walletSignFn: (message: string | Uint8Array) => Promise<string>,
  nonce: number,
  params: {
    userPubkey: Uint8Array;
    sessionPubkey: Uint8Array;
    // If not specified, set to current moment plus default session TTL
    expiryTimestamp?: number;
  },
): Promise<bigint> {
  return createSessionImpl(
    makeSendHttp(serverUrl),
    walletSignFn,
    nonce,
    params,
  );
}

async function revokeSessionImpl(
  sendFn: (encoded: Uint8Array) => Promise<Uint8Array>,
  walletSignFn: (message: string | Uint8Array) => Promise<string>,
  nonce: number,
  params: {
    sessionId: BigIntValue;
  },
): Promise<void> {
  const action: proto.Action = {
    currentTimestamp: BigInt(getCurrentTimestamp()),
    nonce,
    kind: {
      $case: "revokeSession",
      value: {
        sessionId: BigInt(params.sessionId),
      },
    },
  };

  await sendAction(
    sendFn,
    (m) => walletSign(walletSignFn, m),
    action,
    "create a new session",
  );
}

export async function revokeSession(
  serverUrl: string,
  walletSignFn: (message: string | Uint8Array) => Promise<string>,
  nonce: number,
  params: {
    sessionId: BigIntValue;
  },
): Promise<void> {
  return revokeSessionImpl(
    makeSendHttp(serverUrl),
    walletSignFn,
    nonce,
    params,
  );
}

async function withdrawImpl(
  sendFn: (encoded: Uint8Array) => Promise<Uint8Array>,
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  nonce: number,
  params: {
    sizeDecimals: number;
    sessionId: BigIntValue;
    tokenId: number;
    amount: Decimal.Value;
  },
): Promise<void> {
  const amount = toScaledU64(params.amount, params.sizeDecimals);

  if (amount <= 0) {
    throw new Error("Withdraw amount must be positive");
  }

  const action: proto.Action = {
    currentTimestamp: BigInt(getCurrentTimestamp()),
    nonce,
    kind: {
      $case: "withdraw",
      value: {
        sessionId: BigInt(params.sessionId),
        tokenId: params.tokenId,
        amount,
      },
    },
  };

  await sendAction(sendFn, (m) => sessionSign(signFn, m), action, "withdraw");
}

export async function withdraw(
  serverUrl: string,
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  nonce: number,
  params: {
    sizeDecimals: number;
    sessionId: BigIntValue;
    tokenId: number;
    amount: number;
  },
): Promise<void> {
  return withdrawImpl(makeSendHttp(serverUrl), signFn, nonce, params);
}

async function placeOrderImpl(
  sendFn: (encoded: Uint8Array) => Promise<Uint8Array>,
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  nonce: number,
  params: {
    sessionId: BigIntValue;
    senderId?: number;
    liquidateeId?: number;
    sizeDecimals: number;
    priceDecimals: number;
    marketId: number;
    side: Side;
    fillMode: FillMode;
    isReduceOnly: boolean;
    // NOTE: if `size` equals 1.0, it will sell whole unit, for example 1.0 BTC
    size?: Decimal.Value;
    price?: Decimal.Value;
    quoteSize?: Decimal.Value;
    clientOrderId?: BigIntValue;
  },
): Promise<bigint | undefined> {
  const price = toScaledU64(params.price ?? 0, params.priceDecimals);
  const size = toScaledU64(params.size ?? 0, params.sizeDecimals);
  const quoteSize = toScaledU128(
    params.quoteSize ?? 0,
    params.priceDecimals + params.sizeDecimals,
  );

  // Compose action object
  const action: proto.Action = {
    currentTimestamp: BigInt(getCurrentTimestamp()),
    nonce,
    kind: {
      $case: "placeOrder",
      value: {
        sessionId: BigInt(params.sessionId),
        senderAccountId: params.senderId,
        marketId: params.marketId,
        side: params.side === Side.Bid ? proto.Side.BID : proto.Side.ASK,
        fillMode: fillModeToProtoFillMode(params.fillMode),
        isReduceOnly: params.isReduceOnly,
        price,
        size,
        quoteSize: bigIntToProtoU128(quoteSize),
        clientOrderId: optMap(params.clientOrderId, (x) => BigInt(x)),
        delegatorAccountId: params.liquidateeId,
      },
    },
  };

  const resp = await sendAction(
    sendFn,
    (m) => sessionSign(signFn, m),
    action,
    "place the order",
  );

  if (resp.kind?.$case === "placeOrderResult") {
    return resp.kind.value.posted?.orderId;
  } else {
    throw new Error(`Unexpected receipt kind ${resp.kind?.$case}`);
  }
}

export async function placeOrder(
  serverUrl: string,
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  nonce: number,
  params: {
    sessionId: BigIntValue;
    senderId?: number;
    sizeDecimals: number;
    priceDecimals: number;
    marketId: number;
    side: Side;
    fillMode: FillMode;
    isReduceOnly: boolean;
    size?: Decimal.Value;
    price?: Decimal.Value;
    quoteSize?: Decimal.Value;
    liquidateeId?: number;
    clientOrderId?: BigIntValue;
  },
): Promise<bigint | undefined> {
  return placeOrderImpl(makeSendHttp(serverUrl), signFn, nonce, params);
}

async function cancelOrderImpl(
  sendFn: (encoded: Uint8Array) => Promise<Uint8Array>,
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  nonce: number,
  params: {
    sessionId: BigIntValue;
    senderId?: number;
    orderId: BigIntValue;
    liquidateeId?: number;
  },
): Promise<bigint> {
  const action: proto.Action = {
    currentTimestamp: BigInt(getCurrentTimestamp()),
    nonce: nonce,
    kind: {
      $case: "cancelOrderById",
      value: {
        orderId: BigInt(params.orderId),
        sessionId: BigInt(params.sessionId),
        senderAccountId: params.senderId,
        delegatorAccountId: params.liquidateeId,
      },
    },
  };

  const resp = await sendAction(
    sendFn,
    (m) => sessionSign(signFn, m),
    action,
    "cancel the order",
  );

  if (resp.kind?.$case === "cancelOrderResult") {
    return resp.kind.value.orderId;
  } else {
    throw new Error(`Unexpected receipt kind ${resp.kind?.$case}`);
  }
}

export async function cancelOrder(
  serverUrl: string,
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  nonce: number,
  params: {
    sessionId: BigIntValue;
    senderId?: number;
    orderId: BigIntValue;
    liquidateeId?: number;
  },
): Promise<bigint> {
  return cancelOrderImpl(makeSendHttp(serverUrl), signFn, nonce, params);
}
/**
 * For testing purposes
 */
export const _private = {
  createSessionImpl,
  revokeSessionImpl,
  withdrawImpl,
  placeOrderImpl,
  cancelOrderImpl,
};
