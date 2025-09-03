import { describe, it, expect } from "@jest/globals";
import { toScaledU64, toScaledU128, decodeLengthDelimited } from "../src/utils";
import Decimal from "decimal.js";
import * as proto from "../src/gen/nord_pb";
import { create } from "@bufbuild/protobuf";
import { sizeDelimitedEncode } from "@bufbuild/protobuf/wire";
import { QuoteSize } from "../src/types";

describe("toScaledU64", () => {
  // Used as scaling medium
  const D64 = Decimal.clone({
    precision: 20,
    toExpPos: 20,
    toExpNeg: -20,
  });

  const MaxDec = new D64(2).pow(64).sub(1);
  const MaxUint = BigInt(MaxDec.toString());

  const success: Array<[Decimal.Value, number, bigint]> = [
    [0, 0, 0n],
    [1, 0, 1n],
    [123.45, 3, 123450n],
    [MaxDec, 0, MaxUint],
    [MaxDec.div(1000), 3, MaxUint],
  ];

  success.forEach((sample) => {
    it(`Convert decimal ${sample[0]}*10^${sample[1]} to bignum ${sample[2]} should succeed`, () => {
      expect(toScaledU64(sample[0], sample[1])).toEqual(sample[2]);
    });
  });

  const failure: Array<[Decimal.Value, number, string]> = [
    [-1, 0, "Number is negative"],
    [-1000, 2, "Number is negative"],
    [0.1, 0, "Precision loss"],
    [0.0001, 3, "Precision loss"],
    [MaxDec.add(1), 0, "Integer is out of range"],
    [MaxDec.add(1).div(1000), 3, "Integer is out of range"],
  ];

  failure.forEach((sample) => {
    it(`Convert decimal ${sample[0]}/10^${sample[1]} to bignum should fail with ${sample[2]} `, () => {
      expect(() => toScaledU64(sample[0], sample[1])).toThrow(sample[2]);
    });
  });
});

describe("toScaledU128", () => {
  // Used as scaling medium
  const D128 = Decimal.clone({
    precision: 40,
    toExpPos: 40,
    toExpNeg: -40,
  });

  const MaxDec = new D128(2).pow(128).sub(1);
  const MaxUint = BigInt(MaxDec.toString());

  const success: Array<[Decimal.Value, number, bigint]> = [
    [0, 0, 0n],
    [1, 0, 1n],
    [123.45, 3, 123450n],
    [MaxDec, 0, MaxUint],
    [MaxDec.div(1000), 3, MaxUint],
  ];

  success.forEach((sample) => {
    it(`Convert decimal ${sample[0]}*10^${sample[1]} to bignum ${sample[2]} should succeed`, () => {
      expect(toScaledU128(sample[0], sample[1])).toEqual(sample[2]);
    });
  });

  const failure: Array<[Decimal.Value, number, string]> = [
    [-1, 0, "Number is negative"],
    [-1000, 2, "Number is negative"],
    [0.1, 0, "Precision loss"],
    [0.0001, 3, "Precision loss"],
    [MaxDec.add(1), 0, "Integer is out of range"],
    [MaxDec.add(1).div(1000), 3, "Integer is out of range"],
  ];

  failure.forEach((sample) => {
    it(`Convert decimal ${sample[0]}/10^${sample[1]} to bignum should fail with ${sample[2]} `, () => {
      expect(() => toScaledU128(sample[0], sample[1])).toThrow(sample[2]);
    });
  });
});

describe("proto.Action encode-decode loop", () => {
  const action_1 = create(proto.ActionSchema, {
    currentTimestamp: 0n,
    nonce: 0,
    kind: {
      case: "placeOrder",
      value: create(proto.Action_PlaceOrderSchema, {
        sessionId: 42n,
        marketId: 9,
        fillMode: proto.FillMode.LIMIT,
        side: proto.Side.ASK,
        isReduceOnly: false,
        price: 12n,
        size: 39n,
        quoteSize: create(proto.QuoteSizeSchema, { size: 54n, price: 55n }),
        clientOrderId: 350n,
      }),
    },
  });

  const quoteSize = new QuoteSize(25, 107_000);
  const priceSize = quoteSize.toScaledU64(3, 4);
  const action_2 = create(proto.ActionSchema, {
    currentTimestamp: 0n,
    nonce: 0,
    kind: {
      case: "placeOrder",
      value: create(proto.Action_PlaceOrderSchema, {
        sessionId: 42n,
        marketId: 9,
        fillMode: proto.FillMode.LIMIT,
        side: proto.Side.ASK,
        isReduceOnly: false,
        quoteSize: create(proto.QuoteSizeSchema, {
          size: priceSize.size,
          price: priceSize.price,
        }),
        clientOrderId: 350n,
      }),
    },
  });

  it("action encode-decode roundabout should succeed", () => {
    function assert_encdec(action: proto.Action) {
      const encoded = sizeDelimitedEncode(proto.ActionSchema, action);
      const decoded: proto.Action = decodeLengthDelimited(
        encoded,
        proto.ActionSchema,
      );
      expect(decoded).toEqual(action);
    }
    assert_encdec(action_1);
    assert_encdec(action_2);
  });
});
