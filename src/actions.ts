import Decimal from "decimal.js";
import * as proto from "./gen/nord_pb";
import { paths } from "./gen/openapi";
import createClient from "openapi-fetch";
import { create } from "@bufbuild/protobuf";
import {
  FillMode,
  fillModeToProtoFillMode,
  Side,
  QuoteSize,
  TriggerKind,
} from "./types";
import {
  assert,
  BigIntValue,
  decodeLengthDelimited,
  SESSION_TTL,
  toScaledU64,
  signUserPayload,
} from "./utils";
import { sizeDelimitedEncode } from "@bufbuild/protobuf/wire";
import { NordError } from "./error";
import { PublicKey, Transaction } from "@solana/web3.js";

type ReceiptKind = NonNullable<proto.Receipt["kind"]>;
type ExtractReceiptKind<K extends ReceiptKind["case"]> = Extract<
  ReceiptKind,
  { case: K }
>;

export function formatReceiptError(receipt: proto.Receipt): string {
  if (receipt.kind?.case === "err") {
    const err = receipt.kind.value;
    return proto.Error[err] ?? err.toString();
  }
  return receipt.kind?.case ?? "unknown";
}

export function expectReceiptKind<K extends ReceiptKind["case"]>(
  receipt: proto.Receipt,
  expected: K,
  action: string,
): asserts receipt is proto.Receipt & { kind: ExtractReceiptKind<K> } {
  if (receipt.kind?.case !== expected) {
    const label = formatReceiptError(receipt);
    throw new NordError(`Failed to ${action}: ${label}`);
  }
}

async function sessionSign(
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  message: Uint8Array,
): Promise<Uint8Array> {
  const signature = await signFn(message);
  return new Uint8Array([...message, ...signature]);
}

// Helper to create an action with common fields
export function createAction(
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

export async function sendAction(
  serverUrl: string,
  makeSignedMessage: (message: Uint8Array) => Promise<Uint8Array>,
  action: proto.Action,
): Promise<proto.Receipt> {
  const body = await prepareAction(action, makeSignedMessage);
  // NOTE: restructure and reuse client as it is in Nord.ts
  const client = createClient<paths>({ baseUrl: serverUrl });
  const response = await client.POST("/action", {
    params: {
      header: {
        "content-type": "application/octet-stream",
      },
    },
    body: body,
    // NOTE: openapi-fetch ignores headers and types/const headers in schema, and always assume all things are JSON
    // to handle multi type bodies, need these overrides and later adhoc parsing
    bodySerializer: (body) => body,
    parseAs: "stream",
  });

  if (response.error) {
    throw new Error(
      `Failed to ${action.kind.case}, HTTP status ${JSON.stringify(response.error)}`,
    );
  }

  const rawResp = new Uint8Array(await response.response.bytes());

  const resp: proto.Receipt = decodeLengthDelimited(
    rawResp,
    proto.ReceiptSchema,
  );

  if (resp.kind?.case === "err") {
    throw new Error(
      `Could not execute ${action.kind.case}, reason: ${proto.Error[resp.kind.value]}`,
    );
  }

  return resp;
}

// Given action and signature function, prepare the signed message to send to server as `body`.
// `makeSignedMessage` must include the original message and signature.
export async function prepareAction(
  action: proto.Action,
  makeSignedMessage: (message: Uint8Array) => Promise<Uint8Array>,
) {
  const encoded = sizeDelimitedEncode(proto.ActionSchema, action);
  // NOTE(agent): keep in sync with MAX_ENCODED_ACTION_SIZE in Rust code
  const MAX_ENCODED_ACTION_SIZE = 1024;
  if (encoded.byteLength > MAX_ENCODED_ACTION_SIZE) {
    console.warn("Encoded message:", encoded);
    throw new Error(
      `Encoded message size (${encoded.byteLength} bytes) is greater than max payload size (${MAX_ENCODED_ACTION_SIZE} bytes).`,
    );
  }
  const body = await makeSignedMessage(encoded);
  if (body.byteLength > MAX_ENCODED_ACTION_SIZE) {
    console.warn("Encoded length:", encoded.byteLength);
    throw new Error(
      `Signed message size (${body.byteLength} bytes) is greater than max payload size (${MAX_ENCODED_ACTION_SIZE} bytes).`,
    );
  }
  return body;
}

export async function createSession(
  serverUrl: string,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  currentTimestamp: bigint,
  nonce: number,
  params: {
    userPubkey: PublicKey;
    sessionPubkey: PublicKey;
    // If not specified, set to current moment plus default session TTL
    expiryTimestamp?: bigint;
  },
): Promise<{ actionId: bigint; sessionId: bigint }> {
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
      userPubkey: params.userPubkey.toBytes(),
      blstPubkey: params.sessionPubkey.toBytes(),
      expiryTimestamp: expiry,
    }),
  });

  const resp = await sendAction(
    serverUrl,
    async (payload) => {
      return new Uint8Array([
        ...payload,
        ...(await signUserPayload({
          payload,
          user: params.userPubkey,
          signTransaction,
        })),
      ]);
    },
    action,
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
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  currentTimestamp: bigint,
  nonce: number,
  params: {
    sessionId: BigIntValue;
    userPubkey: PublicKey;
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
    async (payload) => {
      return new Uint8Array([
        ...payload,
        ...(await signUserPayload({
          payload,
          user: params.userPubkey,
          signTransaction,
        })),
      ]);
    },
    action,
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
    quoteSize?: QuoteSize;
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

  const scaledQuote = params.quoteSize
    ? params.quoteSize.toWire(params.priceDecimals, params.sizeDecimals)
    : undefined;

  assert(
    price > 0n || size > 0n || scaledQuote !== undefined,
    "OrderLimit must include at least one of: size, price, or quoteSize",
  );

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
      quoteSize:
        scaledQuote === undefined
          ? undefined
          : create(proto.QuoteSizeSchema, {
              size: scaledQuote.size,
              price: scaledQuote.price,
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

export async function addTrigger(
  serverUrl: string,
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  currentTimestamp: bigint,
  nonce: number,
  params: {
    sessionId: BigIntValue;
    marketId: number;
    side: Side;
    kind: TriggerKind;
    priceDecimals: number;
    triggerPrice: Decimal.Value;
    limitPrice?: Decimal.Value;
    accountId?: number;
  },
): Promise<{ actionId: bigint }> {
  const triggerPrice = toScaledU64(params.triggerPrice, params.priceDecimals);
  assert(triggerPrice > 0n, "Trigger price must be positive");
  const limitPrice =
    params.limitPrice === undefined
      ? undefined
      : toScaledU64(params.limitPrice, params.priceDecimals);
  if (limitPrice !== undefined) {
    assert(limitPrice > 0n, "Limit price must be positive");
  }
  const key = create(proto.TriggerKeySchema, {
    kind:
      params.kind === TriggerKind.StopLoss
        ? proto.TriggerKind.STOP_LOSS
        : proto.TriggerKind.TAKE_PROFIT,
    side: params.side === Side.Bid ? proto.Side.BID : proto.Side.ASK,
  });
  const prices = create(proto.Action_TriggerPricesSchema, {
    triggerPrice,
    limitPrice,
  });
  const action = createAction(currentTimestamp, nonce, {
    case: "addTrigger",
    value: create(proto.Action_AddTriggerSchema, {
      sessionId: BigInt(params.sessionId),
      marketId: params.marketId,
      key,
      prices,
      accountId: params.accountId,
    }),
  });
  const resp = await sendAction(
    serverUrl,
    (m) => sessionSign(signFn, m),
    action,
  );
  if (resp.kind?.case === "triggerAdded") {
    return { actionId: resp.actionId };
  }
  throw new Error(`Unexpected receipt kind ${resp.kind?.case}`);
}

export async function removeTrigger(
  serverUrl: string,
  signFn: (message: Uint8Array) => Promise<Uint8Array>,
  currentTimestamp: bigint,
  nonce: number,
  params: {
    sessionId: BigIntValue;
    marketId: number;
    side: Side;
    kind: TriggerKind;
    accountId?: number;
  },
): Promise<{ actionId: bigint }> {
  const key = create(proto.TriggerKeySchema, {
    kind:
      params.kind === TriggerKind.StopLoss
        ? proto.TriggerKind.STOP_LOSS
        : proto.TriggerKind.TAKE_PROFIT,
    side: params.side === Side.Bid ? proto.Side.BID : proto.Side.ASK,
  });
  const action = createAction(currentTimestamp, nonce, {
    case: "removeTrigger",
    value: create(proto.Action_RemoveTriggerSchema, {
      sessionId: BigInt(params.sessionId),
      marketId: params.marketId,
      key,
      accountId: params.accountId,
    }),
  });
  const resp = await sendAction(
    serverUrl,
    (m) => sessionSign(signFn, m),
    action,
  );
  if (resp.kind?.case === "triggerRemoved") {
    return { actionId: resp.actionId };
  }
  throw new Error(`Unexpected receipt kind ${resp.kind?.case}`);
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
      quoteSize?: QuoteSize;
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
      const scaledQuote = a.quoteSize
        ? a.quoteSize.toWire(a.priceDecimals, a.sizeDecimals)
        : undefined;

      // Require at least one limit to be set (non-zero size, non-zero price, or quoteSize)
      assert(
        price > 0n || size > 0n || scaledQuote !== undefined,
        "OrderLimit must include at least one of: size, price, or quoteSize",
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
            quoteSize:
              scaledQuote === undefined
                ? undefined
                : create(proto.QuoteSizeSchema, {
                    size: scaledQuote.size,
                    price: scaledQuote.price,
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
  );
  if (resp.kind?.case === "atomic") {
    return {
      actionId: resp.actionId,
      results: resp.kind.value.results,
    };
  }
  throw new Error(`Unexpected receipt kind ${resp.kind?.case}`);
}
