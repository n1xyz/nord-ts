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

// Helper to create an action with common fields
function createAction(
  currentTimestamp: bigint,
  nonce: number,
  kind: proto.Action["kind"],
): proto.Action {
  return create(proto.ActionSchema, {
    currentTimestamp,
    nonce,
    kind,
  });
}

async function sendAction(
  serverUrl: string,
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

  // TODO: this should be changed to use openapi
  const response = await checkedFetch(`${serverUrl}/action`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });
  const rawResp = new Uint8Array(await response.arrayBuffer());

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
): Promise<{ actionId: bigint; sessionId: bigint }> {
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

  const action = createAction(currentTimestamp, nonce, {
    case: "createSession",
    value: create(proto.Action_CreateSessionSchema, {
      userPubkey: params.userPubkey,
      blstPubkey: params.sessionPubkey,
      expiryTimestamp: expiry,
    }),
  });

  const resp = await sendAction(
    serverUrl,
    (m) => walletSign(walletSignFn, m),
    action,
    "create a new session",
  );

  if (resp.kind?.case === "createSessionResult") {
    return {
      actionId: resp.actionId,
      sessionId: resp.kind.value.sessionId,
    };
  } else {
    throw new Error(`Unexpected receipt kind ${resp.kind?.case}`);
  }
}

export async function revokeSession(
  serverUrl: string,
  walletSignFn: (message: string | Uint8Array) => Promise<Uint8Array>,
  currentTimestamp: bigint,
  nonce: number,
  params: {
    sessionId: BigIntValue;
  },
): Promise<{ actionId: bigint }> {
  const action = createAction(currentTimestamp, nonce, {
    case: "revokeSession",
    value: create(proto.Action_RevokeSessionSchema, {
      sessionId: BigInt(params.sessionId),
    }),
  });

  const resp = await sendAction(
    serverUrl,
    (m) => walletSign(walletSignFn, m),
    action,
    "revoke session",
  );

  return { actionId: resp.actionId };
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
    amount: Decimal.Value;
  },
): Promise<{ actionId: bigint } & proto.Receipt_WithdrawResult> {
  const amount = toScaledU64(params.amount, params.sizeDecimals);

  if (amount <= 0) {
    throw new Error("Withdraw amount must be positive");
  }

  const action = createAction(currentTimestamp, nonce, {
    case: "withdraw",
    value: create(proto.Action_WithdrawSchema, {
      sessionId: BigInt(params.sessionId),
      tokenId: params.tokenId,
      amount,
    }),
  });

  const resp = await sendAction(
    serverUrl,
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
    // NOTE: if `size` equals 1.0, it will sell whole unit, for example 1.0 BTC
    size?: Decimal.Value;
    price?: Decimal.Value;
    quoteSize?: Decimal.Value;
    liquidateeId?: number;
    clientOrderId?: BigIntValue;
  },
): Promise<{
  actionId: bigint;
  orderId?: bigint;
  fills: proto.Receipt_Trade[];
}> {
  const price = toScaledU64(params.price ?? 0, params.priceDecimals);
  const size = toScaledU64(params.size ?? 0, params.sizeDecimals);
  const quoteSize = toScaledU64(params.quoteSize ?? 0, params.sizeDecimals);
  const quotePrice = 0n; // Always 0 for now based on existing code

  const action = createAction(currentTimestamp, nonce, {
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
  });

  const resp = await sendAction(
    serverUrl,
    (m) => sessionSign(signFn, m),
    action,
    "place order",
  );

  if (resp.kind?.case === "placeOrderResult") {
    return {
      actionId: resp.actionId,
      orderId: resp.kind.value.posted?.orderId,
      fills: resp.kind.value.fills,
    };
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
): Promise<{
  actionId: bigint;
  orderId: bigint;
  accountId: number;
}> {
  const action = createAction(currentTimestamp, nonce, {
    case: "cancelOrderById",
    value: create(proto.Action_CancelOrderByIdSchema, {
      orderId: BigInt(params.orderId),
      sessionId: BigInt(params.sessionId),
      senderAccountId: params.senderId,
      delegatorAccountId: params.liquidateeId,
    }),
  });

  const resp = await sendAction(
    serverUrl,
    (m) => sessionSign(signFn, m),
    action,
    "cancel order",
  );

  if (resp.kind?.case === "cancelOrderResult") {
    return {
      actionId: resp.actionId,
      orderId: resp.kind.value.orderId,
      accountId: resp.kind.value.accountId,
    };
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
): Promise<{
  actionId: bigint;
  fromAccountId: number;
  toAccountId?: number;
  tokenId: number;
  amount: bigint;
  accountCreated: boolean;
}> {
  const action = createAction(currentTimestamp, nonce, {
    case: "transfer",
    value: create(proto.Action_TransferSchema, {
      sessionId: BigInt(params.sessionId),
      fromAccountId: params.fromAccountId,
      toAccountId: params.toAccountId,
      tokenId: params.tokenId,
      amount: toScaledU64(params.amount ?? 0, params.tokenDecimals),
    }),
  });

  const resp = await sendAction(
    serverUrl,
    (m) => sessionSign(signFn, m),
    action,
    "transfer",
  );

  if (resp.kind?.case === "transferred") {
    return {
      actionId: resp.actionId,
      fromAccountId: resp.kind.value.fromAccountId,
      toAccountId: resp.kind.value.toUserAccount,
      tokenId: resp.kind.value.tokenId,
      amount: resp.kind.value.amount,
      accountCreated: resp.kind.value.accountCreated,
    };
  } else {
    throw new Error(`Unexpected receipt kind ${resp.kind?.case}`);
  }
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
): Promise<{
  actionId: bigint;
  results: proto.Receipt_AtomicSubactionResultKind[];
}> {
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

  const action = createAction(currentTimestamp, nonce, {
    case: "atomic",
    value: create(proto.AtomicSchema, {
      sessionId: BigInt(params.sessionId),
      accountId: params.accountId, // optional
      actions: subactions,
    }),
  });

  const resp = await sendAction(
    serverUrl,
    (m) => sessionSign(signFn, m),
    action,
    "execute atomic action",
  );
  if (resp.kind?.case === "atomic") {
    return {
      actionId: resp.actionId,
      results: resp.kind.value.results,
    };
  }
  throw new Error(`Unexpected receipt kind ${resp.kind?.case}`);
}
