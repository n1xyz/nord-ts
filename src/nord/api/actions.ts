import Decimal from "decimal.js";
import * as proto from "../../gen/nord_pb";
import { create } from "@bufbuild/protobuf";
import { FillMode, fillModeToProtoFillMode, KeyType, Side } from "../../types";
import {
  assert,
  BigIntValue,
  checkedFetch,
  checkPubKeyLength,
  decodeLengthDelimited,
  SESSION_TTL,
  toScaledU64,
} from "../../utils";
import { sizeDelimitedEncode } from "@bufbuild/protobuf/wire";

async function sessionSign(
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  message: Uint8Array,
): Promise<Uint8Array> {
  const signature = await signFn(message);
  return new Uint8Array([...message, ...signature]);
}

async function walletSign(
  walletSignFn: (message: string | Uint8Array) => Promise<Uint8Array>,
  message: Uint8Array,
): Promise<Uint8Array> {
  const signature = await walletSignFn(message);
  return new Uint8Array([...message, ...signature]);
}

function makeSendHttp(
  serverUrl: string,
): (encoded: Uint8Array) => Promise<Uint8Array> {
  return async (body) => {
    // TODO: this should be changed to use openapi
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
  const encoded = sizeDelimitedEncode(proto.ActionSchema, action);
  // validate the payload size
  const MAX_PAYLOAD_SIZE = 100 * 1024; // 100 kB
  if (encoded.byteLength > MAX_PAYLOAD_SIZE) {
    throw new Error(
      `Encoded message size (${encoded.byteLength} bytes) is greater than max payload size (${MAX_PAYLOAD_SIZE} bytes).`,
    );
  }
  const body = await makeSignedMessage(encoded);
  const rawResp = await sendFn(body);
  const resp: proto.Receipt = decodeLengthDelimited(
    rawResp,
    proto.ReceiptSchema,
  );

  if (resp.kind?.case === "err") {
    throw new Error(
      `Could not ${actionErrorDesc}, reason: ${proto.Error[resp.kind.value]}`,
    );
  }

  return resp;
}

async function createSessionImpl(
  sendFn: (encoded: Uint8Array) => Promise<Uint8Array>,
  walletSignFn: (message: string | Uint8Array) => Promise<Uint8Array>,
  currentTimestamp: bigint,
  nonce: number,
  params: {
    userPubkey: Uint8Array;
    sessionPubkey: Uint8Array;
    // If not specified, set to current moment plus default session TTL
    expiryTimestamp?: bigint;
  },
): Promise<bigint> {
  checkPubKeyLength(KeyType.Ed25519, params.userPubkey.length);
  checkPubKeyLength(KeyType.Ed25519, params.sessionPubkey.length);

  let expiry = 0n;

  if (params.expiryTimestamp !== undefined) {
    expiry = params.expiryTimestamp;
    assert(
      expiry > currentTimestamp,
      "Cannot set expiry timestamp in the past",
    );
  } else {
    expiry = currentTimestamp + SESSION_TTL;
  }

  const action = create(proto.ActionSchema, {
    currentTimestamp,
    nonce,
    kind: {
      case: "createSession",
      value: create(proto.Action_CreateSessionSchema, {
        userPubkey: params.userPubkey,
        blstPubkey: params.sessionPubkey,
        expiryTimestamp: expiry,
      }),
    },
  });

  const resp = await sendAction(
    sendFn,
    (m) => walletSign(walletSignFn, m),
    action,
    "create a new session",
  );

  if (resp.kind?.case === "createSessionResult") {
    return resp.kind.value.sessionId;
  } else {
    throw new Error(`Unexpected receipt kind ${resp.kind?.case}`);
  }
}

export async function createSession(
  serverUrl: string,
  walletSignFn: (message: string | Uint8Array) => Promise<Uint8Array>,
  currentTimestamp: bigint,
  nonce: number,
  params: {
    userPubkey: Uint8Array;
    sessionPubkey: Uint8Array;
    // If not specified, set to current moment plus default session TTL
    expiryTimestamp?: bigint;
  },
): Promise<bigint> {
  return createSessionImpl(
    makeSendHttp(serverUrl),
    walletSignFn,
    currentTimestamp,
    nonce,
    params,
  );
}

async function revokeSessionImpl(
  sendFn: (encoded: Uint8Array) => Promise<Uint8Array>,
  walletSignFn: (message: string | Uint8Array) => Promise<Uint8Array>,
  currentTimestamp: bigint,
  nonce: number,
  params: {
    sessionId: BigIntValue;
  },
): Promise<void> {
  const action = create(proto.ActionSchema, {
    currentTimestamp,
    nonce,
    kind: {
      case: "revokeSession",
      value: create(proto.Action_RevokeSessionSchema, {
        sessionId: BigInt(params.sessionId),
      }),
    },
  });

  await sendAction(
    sendFn,
    (m) => walletSign(walletSignFn, m),
    action,
    "create a new session",
  );
}

export async function revokeSession(
  serverUrl: string,
  walletSignFn: (message: string | Uint8Array) => Promise<Uint8Array>,
  currentTimestamp: bigint,
  nonce: number,
  params: {
    sessionId: BigIntValue;
  },
): Promise<void> {
  return revokeSessionImpl(
    makeSendHttp(serverUrl),
    walletSignFn,
    currentTimestamp,
    nonce,
    params,
  );
}

async function withdrawImpl(
  sendFn: (encoded: Uint8Array) => Promise<Uint8Array>,
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  currentTimestamp: bigint,
  nonce: number,
  params: {
    sizeDecimals: number;
    sessionId: BigIntValue;
    tokenId: number;
    amount: Decimal.Value;
  },
): Promise<{ actionId: bigint } & proto.Receipt_WithdrawResult> {
  const amount = toScaledU64(params.amount, params.sizeDecimals);

  if (amount <= 0) {
    throw new Error("Withdraw amount must be positive");
  }

  const action = create(proto.ActionSchema, {
    currentTimestamp,
    nonce,
    kind: {
      case: "withdraw",
      value: create(proto.Action_WithdrawSchema, {
        sessionId: BigInt(params.sessionId),
        tokenId: params.tokenId,
        amount,
      }),
    },
  });

  const resp = await sendAction(
    sendFn,
    (m) => sessionSign(signFn, m),
    action,
    "withdraw",
  );

  if (resp.kind?.case === "withdrawResult") {
    return { actionId: resp.actionId, ...resp.kind.value };
  } else {
    throw new Error(`Unexpected receipt kind ${resp.kind?.case}`);
  }
}

export async function withdraw(
  serverUrl: string,
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  currentTimestamp: bigint,
  nonce: number,
  params: {
    sizeDecimals: number;
    sessionId: BigIntValue;
    tokenId: number;
    amount: number;
  },
): Promise<{ actionId: bigint } & proto.Receipt_WithdrawResult> {
  return withdrawImpl(
    makeSendHttp(serverUrl),
    signFn,
    currentTimestamp,
    nonce,
    params,
  );
}

async function placeOrderImpl(
  sendFn: (encoded: Uint8Array) => Promise<Uint8Array>,
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  currentTimestamp: bigint,
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
    quoteSizeSize?: Decimal.Value;
    quoteSizePrice?: Decimal.Value;
    clientOrderId?: BigIntValue;
  },
): Promise<bigint | undefined> {
  const price = toScaledU64(params.price ?? 0, params.priceDecimals);
  const size = toScaledU64(params.size ?? 0, params.sizeDecimals);
  const quoteSize = toScaledU64(params.quoteSizeSize ?? 0, params.sizeDecimals);
  const quotePrice = toScaledU64(
    params.quoteSizePrice ?? 0,
    params.priceDecimals,
  );

  // Compose action object
  const action = create(proto.ActionSchema, {
    currentTimestamp,
    nonce,
    kind: {
      case: "placeOrder",
      value: create(proto.Action_PlaceOrderSchema, {
        sessionId: BigInt(params.sessionId),
        senderAccountId: params.senderId,
        marketId: params.marketId,
        side: params.side === Side.Bid ? proto.Side.BID : proto.Side.ASK,
        fillMode: fillModeToProtoFillMode(params.fillMode),
        isReduceOnly: params.isReduceOnly,
        price,
        size,
        quoteSize: create(proto.QuoteSizeSchema, {
          size: quoteSize,
          price: quotePrice,
        }),
        clientOrderId:
          params.clientOrderId === undefined
            ? undefined
            : BigInt(params.clientOrderId),
        delegatorAccountId: params.liquidateeId,
      }),
    },
  });

  const resp = await sendAction(
    sendFn,
    (m) => sessionSign(signFn, m),
    action,
    "place the order",
  );

  if (resp.kind?.case === "placeOrderResult") {
    return resp.kind.value.posted?.orderId;
  } else {
    throw new Error(`Unexpected receipt kind ${resp.kind?.case}`);
  }
}

export async function placeOrder(
  serverUrl: string,
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  currentTimestamp: bigint,
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
  return placeOrderImpl(
    makeSendHttp(serverUrl),
    signFn,
    currentTimestamp,
    nonce,
    params,
  );
}

async function cancelOrderImpl(
  sendFn: (encoded: Uint8Array) => Promise<Uint8Array>,
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  currentTimestamp: bigint,
  nonce: number,
  params: {
    sessionId: BigIntValue;
    senderId?: number;
    orderId: BigIntValue;
    liquidateeId?: number;
  },
): Promise<bigint> {
  const action = create(proto.ActionSchema, {
    currentTimestamp,
    nonce: nonce,
    kind: {
      case: "cancelOrderById",
      value: create(proto.Action_CancelOrderByIdSchema, {
        orderId: BigInt(params.orderId),
        sessionId: BigInt(params.sessionId),
        senderAccountId: params.senderId,
        delegatorAccountId: params.liquidateeId,
      }),
    },
  });

  const resp = await sendAction(
    sendFn,
    (m) => sessionSign(signFn, m),
    action,
    "cancel the order",
  );

  if (resp.kind?.case === "cancelOrderResult") {
    return resp.kind.value.orderId;
  } else {
    throw new Error(`Unexpected receipt kind ${resp.kind?.case}`);
  }
}

export async function cancelOrder(
  serverUrl: string,
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  currentTimestamp: bigint,
  nonce: number,
  params: {
    sessionId: BigIntValue;
    senderId?: number;
    orderId: BigIntValue;
    liquidateeId?: number;
  },
): Promise<bigint> {
  return cancelOrderImpl(
    makeSendHttp(serverUrl),
    signFn,
    currentTimestamp,
    nonce,
    params,
  );
}

async function transferImpl(
  sendFn: (encoded: Uint8Array) => Promise<Uint8Array>,
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  currentTimestamp: bigint,
  nonce: number,
  params: {
    sessionId: BigIntValue;
    fromAccountId: number;
    toAccountId?: number;
    tokenId: number;
    tokenDecimals: number;
    amount: Decimal.Value;
  },
): Promise<number | undefined> {
  const action = create(proto.ActionSchema, {
    currentTimestamp,
    nonce: nonce,
    kind: {
      case: "transfer",
      value: create(proto.Action_TransferSchema, {
        sessionId: BigInt(params.sessionId),
        fromAccountId: params.fromAccountId,
        toAccountId: params.toAccountId,
        tokenId: params.tokenId,
        amount: toScaledU64(params.amount ?? 0, params.tokenDecimals),
      }),
    },
  });

  const resp = await sendAction(
    sendFn,
    (m) => sessionSign(signFn, m),
    action,
    "transfer asset to other account",
  );

  if (resp.kind?.case === "transferred") {
    if (resp.kind.value.accountCreated) {
      return resp.kind.value.toUserAccount;
    } else {
      return undefined;
    }
  } else {
    throw new Error(`Unexpected receipt kind ${resp.kind?.case}`);
  }
}

export async function transfer(
  serverUrl: string,
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  currentTimestamp: bigint,
  nonce: number,
  params: {
    sessionId: BigIntValue;
    fromAccountId: number;
    toAccountId?: number;
    tokenId: number;
    tokenDecimals: number;
    amount: Decimal.Value;
  },
): Promise<number | undefined> {
  return transferImpl(
    makeSendHttp(serverUrl),
    signFn,
    currentTimestamp,
    nonce,
    params,
  );
}

export type AtomicSubaction =
  | {
      kind: "place";
      // Market and order parameters – identical semantics to placeOrder()
      marketId: number;
      side: Side;
      fillMode: FillMode;
      isReduceOnly: boolean;
      // decimals for scaling
      sizeDecimals: number;
      priceDecimals: number;
      // at least one of the three has to be specified; 0 treated as "not set"
      size?: Decimal.Value;
      price?: Decimal.Value;
      quoteSizeSize?: Decimal.Value;
      quoteSizePrice?: Decimal.Value;
      clientOrderId?: BigIntValue;
    }
  | {
      kind: "cancel";
      orderId: BigIntValue;
    };

async function atomicImpl(
  sendFn: (encoded: Uint8Array) => Promise<Uint8Array>,
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  currentTimestamp: bigint,
  nonce: number,
  params: {
    sessionId: BigIntValue;
    accountId?: number;
    actions: AtomicSubaction[];
  },
): Promise<proto.Receipt_AtomicResult> {
  assert(
    params.actions.length > 0 && params.actions.length <= 4,
    "Atomic action must contain between 1 and 4 sub-actions",
  );

  const subactions: proto.AtomicSubactionKind[] = params.actions.map((a) => {
    if (a.kind === "place") {
      const price = toScaledU64(a.price ?? 0, a.priceDecimals);
      const size = toScaledU64(a.size ?? 0, a.sizeDecimals);
      const quoteSizeSize = toScaledU64(a.quoteSizeSize ?? 0, a.sizeDecimals);
      const quoteSizePrice = toScaledU64(
        a.quoteSizePrice ?? 0,
        a.priceDecimals,
      );
      const tradeOrPlace: proto.TradeOrPlace = create(
        proto.TradeOrPlaceSchema,
        {
          marketId: a.marketId,
          orderType: create(proto.OrderTypeSchema, {
            side: a.side === Side.Bid ? proto.Side.BID : proto.Side.ASK,
            fillMode: fillModeToProtoFillMode(a.fillMode),
            isReduceOnly: a.isReduceOnly,
          }),
          limit: create(proto.OrderLimitSchema, {
            price,
            size,
            quoteSize: create(proto.QuoteSizeSchema, {
              size: quoteSizeSize,
              price: quoteSizePrice,
            }),
          }),
          clientOrderId:
            a.clientOrderId === undefined ? undefined : BigInt(a.clientOrderId),
        },
      );
      return create(proto.AtomicSubactionKindSchema, {
        inner: { case: "tradeOrPlace", value: tradeOrPlace },
      });
    }
    return create(proto.AtomicSubactionKindSchema, {
      inner: {
        case: "cancelOrder",
        value: create(proto.CancelOrderSchema, { orderId: BigInt(a.orderId) }),
      },
    });
  });

  const action = create(proto.ActionSchema, {
    currentTimestamp,
    nonce,
    kind: {
      case: "atomic",
      value: create(proto.AtomicSchema, {
        sessionId: BigInt(params.sessionId),
        accountId: params.accountId, // optional
        actions: subactions,
      }),
    },
  });

  const resp = await sendAction(
    sendFn,
    (m) => sessionSign(signFn, m),
    action,
    "execute atomic action",
  );
  if (resp.kind?.case === "atomic") {
    return resp.kind.value;
  }
  throw new Error(`Unexpected receipt kind ${resp.kind?.case}`);
}

export async function atomic(
  serverUrl: string,
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  currentTimestamp: bigint,
  nonce: number,
  params: {
    sessionId: BigIntValue;
    accountId?: number;
    actions: AtomicSubaction[];
  },
): Promise<proto.Receipt_AtomicResult> {
  return atomicImpl(
    makeSendHttp(serverUrl),
    signFn,
    currentTimestamp,
    nonce,
    params,
  );
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
  transferImpl,
  atomicImpl,
};
