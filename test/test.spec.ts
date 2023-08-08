import { assert, expect } from "chai";
import "mocha";

import { Decimal } from "decimal.js";
import { toVarint, toPbDecimal } from "../src/utils";

describe("encode int to varint", () => {
  const N1 = Math.pow(2, 7);
  const N2 = Math.pow(2, 14);
  const N3 = Math.pow(2, 21);
  const N4 = Math.pow(2, 28);

  function varintLen(value: number) {
    return value < N1
      ? 1
      : value < N2
      ? 2
      : value < N3
      ? 3
      : value < N4
      ? 4
      : 5;
  }

  it("encode single byte", () => {
    const x = 10;
    const result = toVarint(x);
    const expectedResult = new Uint8Array([0xa]);

    assert.deepStrictEqual(result, expectedResult);
  });

  it("encode multiple bytes", () => {
    const x = 300; // 0001 0010 1100
    const result = toVarint(x);
    const expectedResult = new Uint8Array([0xac, 0x02]); // 1010 1100 0000 0010

    assert.deepStrictEqual(result, expectedResult);
  });

  it("encode more multiple bytes", () => {
    const x = 0x0ff56; // 0000 1111 1111 0101 0110
    const result = toVarint(x);
    const expectedResult = new Uint8Array([0xd6, 0xfe, 0x03]); // 1101 0110 1111 1110 0000 0011

    assert.deepStrictEqual(result, expectedResult);
  });

  it("encode multiple bytes with zero first byte", () => {
    const x = 0x0f00; // 0000 1111 0000 0000
    const result = toVarint(x);
    const expectedResult = new Uint8Array([0x80, 0x1e]); // 1000 0000 0001 1110

    assert.deepStrictEqual(result, expectedResult);
  });

  it("encoded length", () => {
    for (let i = 0; i <= 31; i++) {
      const n = Math.pow(2, i) - 1;
      assert.strictEqual(toVarint(n).length, varintLen(n));
    }
  });

  it("encode large number", () => {
    const x = 0x773cf53f; // 2000483647, 0111 0111 0011 1100 1111 0101 0011 1111
    const result = toVarint(x);
    const expectedResult = new Uint8Array([0xbf, 0xea, 0xf3, 0xb9, 0x07]); // 1011 1111 1110 1010 1111 0011 1011 1001 0000 0111

    assert.deepStrictEqual(result, expectedResult);
  });

  it("errors", () => {
    expect(() => toVarint(1.5)).to.throw("Can only encode integer to varint.");
    expect(() => toVarint(-100)).to.throw(
      "Cannot encode negative integer to varint."
    );
    expect(() => toVarint(0xffffffffff)).to.throw(
      "Can only encode up to int32 max."
    );
  });
});

describe("encode js decimal to pb decimal", () => {
  it("integer", () => {
    let x = new Decimal("5032");
    let result = toPbDecimal(x).encodedDecimal;
    let expectedResult = new Uint8Array([0x00, 0xa8, 0x13]);
    assert.deepStrictEqual(result, expectedResult);

    x = new Decimal("-5032");
    result = toPbDecimal(x).encodedDecimal;
    expectedResult = new Uint8Array([0x80, 0xa8, 0x13]);
    assert.deepStrictEqual(result, expectedResult);
  });

  it("decimal", () => {
    let x = new Decimal("19138123.2398322");
    let result = toPbDecimal(x).encodedDecimal;
    let expectedResult = new Uint8Array([
      0x07, 0xf2, 0xaf, 0x5f, 0x6a, 0x0f, 0xae,
    ]);
    assert.deepStrictEqual(result, expectedResult);

    x = new Decimal("-0.12345678901234567");
    result = toPbDecimal(x).encodedDecimal;
    expectedResult = new Uint8Array([
      0x91, 0x87, 0x4b, 0x6b, 0x5d, 0x54, 0xdc, 0x2b,
    ]);
    assert.deepStrictEqual(result, expectedResult);
  });

  it("max 96 bit", () => {
    let x = new Decimal("79228162514264337593543950335");
    let result = toPbDecimal(x).encodedDecimal;
    let expectedResult = new Uint8Array([
      0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      0xff,
    ]);
    assert.deepStrictEqual(result, expectedResult);

    x = new Decimal("-79228162514264337593543950335");
    result = toPbDecimal(x).encodedDecimal;
    expectedResult = new Uint8Array([
      0x80, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      0xff,
    ]);
    assert.deepStrictEqual(result, expectedResult);
  });

  it("max 96 bit decimal", () => {
    let x = new Decimal("79228.162514264337593543950335");
    let result = toPbDecimal(x).encodedDecimal;
    let expectedResult = new Uint8Array([
      0x18, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      0xff,
    ]);
    assert.deepStrictEqual(result, expectedResult);

    x = new Decimal("-792.28162514264337593543950335");
    result = toPbDecimal(x).encodedDecimal;
    expectedResult = new Uint8Array([
      0x9a, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      0xff,
    ]);
    assert.deepStrictEqual(result, expectedResult);
  });

  it("max decimal place", () => {
    let x = new Decimal("3.9614081257132168796771975169");
    let result = toPbDecimal(x).encodedDecimal;
    let expectedResult = new Uint8Array([
      0x1c, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x80,
    ]);

    assert.deepStrictEqual(result, expectedResult);

    x = new Decimal("-3.9614081257132168796771975169");
    result = toPbDecimal(x).encodedDecimal;
    expectedResult = new Uint8Array([
      0x9c, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x80,
    ]);

    assert.deepStrictEqual(result, expectedResult);
  });

  it("zero", () => {
    const x = new Decimal("0");
    const result = toPbDecimal(x).encodedDecimal;
    const expectedResult = new Uint8Array([0x00, 0x00]);

    assert.deepStrictEqual(result, expectedResult);
  });
});
