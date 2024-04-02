import {Decimal} from "decimal.js";
import {ed25519} from "@noble/curves/ed25519";
import {bls12_381 as bls} from "@noble/curves/bls12-381";
import {secp256k1 as secp} from "@noble/curves/secp256k1";
import {sha256} from "@noble/hashes/sha256";
import {KeyType, type Market, type Token} from "./types";
import * as proto from "./gen/nord";

export const SESSION_TTL = 10 * 60 * 1000 * 10000;
export const ZERO_DECIMAL = new Decimal(0);
export const MAX_BUFFER_LEN = 10_000;

const MAX_PAYLOAD_SIZE = 100 * 1024; // 100 kB


export const assert = (pred: boolean): void => {
    if (!pred) {
        throw new Error("assertion violation");
    }
};

/**
 * Signs an action using the specified secret key and key type.
 * @param action - The action data to be signed.
 * @param sk - Secret key used for signing the action.
 * @param keyType - Type of the key used for signing.
 * @returns A new Uint8Array containing the action followed by its signature.
 */
export function signAction(
    action: Uint8Array,
    sk: Uint8Array,
    keyType: KeyType,
): Uint8Array {
    let sig: Uint8Array;
    if (keyType === KeyType.Ed25119) {
        sig = ed25519.sign(action, sk);
    } else if (keyType === KeyType.Bls12_381) {
        sig = bls.sign(action, sk);
    } else if (keyType === KeyType.Secp256k1) {
        sig = secp.sign(sha256(action), sk).toCompactRawBytes();
    } else {
        throw new Error("Invalid key type");
    }
    return new Uint8Array([...action, ...sig]);
}

/**
 * Converts a number to number type with the shift.
 * @param x - value to convert.
 * @param tokenDecimals
 * @returns number.
 */
export function toShiftedNumber(x: number, tokenDecimals: number): number {
    return x * Math.pow(10, tokenDecimals);
}

/**
 * Encodes an Action in length-delimited format.
 * @param a - Action object to encode.
 * @returns Encoded Action as Uint8Array.
 */
export function encodeDelimited(a: proto.nord.Action): Uint8Array {
    const e: Uint8Array = a.serialize();
    if (e.byteLength > MAX_PAYLOAD_SIZE) {
        throw new Error("Encoded action can't be greater than 100 kB.");
    }
    return new Uint8Array([...toVarInt(e.byteLength), ...e]);
}

/**
 * Decodes an Action in length-delimited format.
 * @param u - Encoded Action as Uint8Array to decode.
 * @returns Decoded Action as Uint8Array.
 */
export function decodeActionDelimited(u: Uint8Array): proto.nord.Action {
    // Find the varint length of the protobuf.
    let index = 0;
    let protoLen = 0;
    while (u[index] >> 7 > 0) {
        protoLen |= (u[index] & 0b1111111) << (index * 7);
        index++;
    }
    protoLen |= (u[index] & 0b1111111) << (index * 7);

    // Decode only the part specified by the varint length.
    const remainingLen = u.length - index - 1;
    const len = Math.min(remainingLen, protoLen);
    return proto.nord.Action.deserialize(u.slice(index + 1, index + 1 + len));
}


/**
 * Decodes a Receipt in length-delimited format.
 * @param u - Encoded Receipt as Uint8Array to decode.
 * @returns Decoded Receipt as Uint8Array.
 */
export function decodeDelimited(u: Uint8Array): proto.nord.Receipt {
    let index = 0;
    while (u[index] >> 7 > 0) {
        index++;
    }
    return proto.nord.Receipt.deserialize(u.slice(index + 1));
}

/**
 * Converts an integer to its varint representation.
 * @param x - Integer to encode.
 * @returns Encoded integer as a varint Uint8Array.
 */
export function toVarInt(x: number): Uint8Array {
    if (!Number.isInteger(x)) {
        throw new Error("Can only encode integer to varint.");
    }

    if (x < 0) {
        throw new Error("Cannot encode negative integer to varint.");
    }

    if (x > Math.pow(2, 31) - 1) {
        throw new Error("Can only encode up to int32 max.");
    }

    if (x === 0) {
        return Uint8Array.from([0]);
    }

    x |= 0;

    const r: number[] = [];
    while (x !== 0) {
        r.push(x & 0b1111111);
        x >>= 7;
    }

    for (let i = 0; i < r.length - 1; i += 1) {
        r[i] |= 1 << 7;
    }

    return Uint8Array.from(r);
}

export function checkPubKeyLength(keyType: KeyType, len: number): void {
    if (keyType === KeyType.Bls12_381) {
        throw new Error(
            "Cannot create a user using Bls12_381, use Ed25119 or Secp256k1 instead.",
        );
    }

    if (len !== 32 && keyType === KeyType.Ed25119) {
        throw new Error("Ed25119 pubkeys must be 32 length.");
    }

    if (len !== 33 && keyType === KeyType.Secp256k1) {
        throw new Error("Secp256k1 pubkeys must be 33 length.");
    }
}

/**
 * Retrieves the current timestamp.
 * @returns Current timestamp as a bigint.
 */
export function getCurrentTimestamp(): number {
    return Math.floor(Date.now() / 1000);
}


export function findMarket(markets: Market[], marketId: number): Market {
    if (marketId < 0 || markets.length - 1 < marketId) {
        throw new Error(`The market with marketId=${marketId} not found`);
    }
    return markets[marketId];
}

export function findToken(tokens: Token[], tokenId: number): Token {
    if (tokenId < 0 || tokens.length - 1 < tokenId) {
        throw new Error(`The token with tokenId=${tokenId} not found`);
    }
    return tokens[tokenId];
}




