import { describe, it, expect } from "@jest/globals";
import Decimal from "decimal.js";
import { DECIMAL_U64_MAX, DECIMAL_U128_MAX, decimalToProtoU128 } from "../src/types";

describe("D64 D128", () => {
    it("DECIMAL_U64_MAX exact value", () => {
        expect(DECIMAL_U64_MAX.toString()).toEqual("18446744073709551615");
    });

    it("DECIMAL_U128_MAX exact value", () => {
        expect(DECIMAL_U128_MAX.toString()).toEqual("340282366920938463463374607431768211455");
    });

    it("DECIMAL_U64_MAX should differ from itself +1", () => {
        expect(DECIMAL_U64_MAX).not.toEqual(DECIMAL_U64_MAX.add(1));
    })
    it("DECIMAL_U128_MAX should differ from itself +1", () => {
        expect(DECIMAL_U128_MAX).not.toEqual(DECIMAL_U128_MAX.add(1));
    })
});
// Helper, converts U128 to simple object for comparison
function decimalToObject(x: Decimal.Value): { lo: string, hi: string } {
    let result = decimalToProtoU128(x);
    return {
        lo: result.lo,
        hi: result.hi
    };
}

describe("decimalToProtoU128", () => {
    let success: Array<[Decimal.Value, object]> = [
        [0, { lo: "0", hi: "0" }],
        [1, { lo: "1", hi: "0" }],
        [DECIMAL_U64_MAX.sub(1), { lo: "18446744073709551614", hi: "0" }],
        [DECIMAL_U64_MAX, { lo: "18446744073709551615", hi: "0" }],
        [DECIMAL_U64_MAX.add(1), { lo: "0", hi: "1" }],
        [DECIMAL_U128_MAX.sub(1), { lo: "18446744073709551614", hi: "18446744073709551615" }],
        [DECIMAL_U128_MAX, { lo: "18446744073709551615", hi: "18446744073709551615" }],
    ];

    success.forEach((sample, index) => {
        it(`Conversion to Protobuf's U128 should succeed: case ${index}`, () => {
            expect(decimalToObject(sample[0])).toEqual(sample[1]);
        });
    });

    let failure: Array<[Decimal.Value, string]> = [
        [-1, "negative number"],
        [DECIMAL_U128_MAX.add(1), "number overflow"],
    ];

    failure.forEach((sample, index) => {
        it(`Conversion to Protobuf's U128 should fail: case ${index}`, () => {
            expect(() => decimalToObject(sample[0])).toThrow(sample[1]);
        });
    })
});
