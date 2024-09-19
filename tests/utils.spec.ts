import { describe, it, expect } from "@jest/globals";
import {
  bigIntToProtoU128,
  toScaledU64,
  toScaledU128,
  encodeLengthDelimited,
  decodeLengthDelimited,
} from "../src/utils";
import Decimal from "decimal.js";
import * as proto from "../src/gen/nord";

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

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

describe("bigIntToProtoU128", () => {
  const success: Array<[bigint, { lo: bigint; hi: bigint }]> = [
    [0n, { lo: 0n, hi: 0n }],
    [1n, { lo: 1n, hi: 0n }],
    [U64_MAX - 1n, { lo: U64_MAX - 1n, hi: 0n }],
    [U64_MAX, { lo: U64_MAX, hi: 0n }],
    [U64_MAX + 1n, { lo: 0n, hi: 1n }],
    [U128_MAX - 1n, { lo: U64_MAX - 1n, hi: U64_MAX }],
    [U128_MAX, { lo: U64_MAX, hi: U64_MAX }],
  ];

  success.forEach((sample, index) => {
    it(`Conversion to Protobuf's U128 should succeed: case ${index}`, () => {
      expect(bigIntToProtoU128(sample[0])).toEqual(sample[1]);
    });
  });

  const failure: Array<[bigint, string]> = [
    [-1n, "Negative number"],
    [U128_MAX + 1n, "U128 overflow"],
  ];

  failure.forEach((sample, index) => {
    it(`Conversion to Protobuf's U128 should fail: case ${index}`, () => {
      expect(() => bigIntToProtoU128(sample[0])).toThrow(sample[1]);
    });
  });
});

describe("proto.Action encode-decode loop", () => {
  const action: proto.Action = {
    currentTimestamp: 0n,
    nonce: 0,
    kind: {
      $case: "placeOrder",
      value: {
        sessionId: 42n,
        marketId: 9,
        fillMode: proto.FillMode.LIMIT,
        side: proto.Side.ASK,
        isReduceOnly: false,
        price: 12n,
        size: 39n,
        quoteSize: { lo: 54n, hi: 55n },
        senderAccountId: undefined,
        delegatorAccountId: undefined,
        clientOrderId: 350n,
      },
    },
  };

  it("action encode-decode roundabout should succeed", () => {
    const encoded = encodeLengthDelimited(action, proto.Action);
    const decoded: proto.Action = decodeLengthDelimited(encoded, proto.Action);

    expect(decoded).toEqual(action);
  });
});
