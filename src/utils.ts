import { Decimal } from "decimal.js";
import { ed25519 } from "@noble/curves/ed25519";
import { bls12_381 as bls } from "@noble/curves/bls12-381";
import { secp256k1 as secp } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { KeyType, type Market, type Token } from "./types";
import { sizeDelimitedPeek } from "@bufbuild/protobuf/wire";
import { fromBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { ethers } from "ethers";
import fetch from "node-fetch";
import { RequestInfo, RequestInit, Response } from "node-fetch";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export const SESSION_TTL: bigint = 60n * 60n * 24n * 30n;
export const ZERO_DECIMAL = new Decimal(0);
export const MAX_BUFFER_LEN = 10_000;

const MAX_PAYLOAD_SIZE = 100 * 1024; // 100 kB

/** Any type convertible to bigint */
export type BigIntValue = bigint | number | string;

export function panic(message: string): never {
  throw new Error(message);
}

export function isRfc3339(s: string): boolean {
  const REGEX =
    /^((?:(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?))(Z|[\+-]\d{2}:\d{2})?)$/;
  return REGEX.test(s);
}

export function assert(predicate: boolean, message?: string): void {
  if (!predicate) panic(message ?? "Assertion violated");
}
/**
 * Extracts value out of optional if it's defined, or throws error if it's not
 * @param value   Optional value to unwrap
 * @param message Error message
 * @returns       Unwrapped value
 */
export function optExpect<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value as T;
}
/** Behaves same as `node-fetch/fetch` but throws if response is a failure
 *
 * @param url   Request HTTP URL
 * @param init  Request parameters
 * @returns     Raw response if fetch succeeded
 * @throws      If response wasn't Ok
 */
export async function checkedFetch(
  url: RequestInfo,
  init?: RequestInit,
): Promise<Response> {
  const resp = await fetch(url, init);
  assert(resp.ok, `Request failed with ${resp.status}: ${resp.statusText}`);
  return resp;
}

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
  if (keyType === KeyType.Ed25519) {
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
 * Constructs wallet signing function, usable with `NordUser` type
 *
 * @param walletKey   Either raw signing key as bytes array or hex string prefixed with `"0x"`
 * @returns           Async function which accepts arbitrary message, generates its digets,
 *                    then signs it with provided user wallet key and returns signature
 *                    as hex string prefixed with `"0x"`
 */
export function makeWalletSignFn(
  walletKey: ethers.BytesLike,
): (message: Uint8Array | string) => Promise<string> {
  const signingKey = new ethers.SigningKey(walletKey);
  return async (message) =>
    signingKey.sign(ethers.hashMessage(message)).serialized;
}

function makeToScaledBigUint(params: {
  precision: number;
  exponent: number;
  bits: number;
}): (x: Decimal.Value, decimals: number) => bigint {
  const Dec = Decimal.clone({
    precision: params.precision,
    toExpPos: params.exponent,
    toExpNeg: -params.exponent,
  });

  const Ten = new Dec(10);

  const Max = new Dec(((1n << BigInt(params.bits)) - 1n).toString());

  return (x, decimals) => {
    const dec = new Dec(x);

    if (dec.isZero()) {
      return 0n;
    }

    if (dec.isNeg()) {
      throw new Error(`Number is negative`);
    }

    const scaled = Ten.pow(decimals).mul(dec).truncated();
    if (scaled.isZero()) {
      throw new Error(
        `Precision loss when converting ${dec} to scaled integer`,
      );
    }

    if (scaled.greaterThan(Max)) {
      throw new Error(
        `Integer is out of range: ${scaled} exceeds limit ${Max}`,
      );
    }

    return BigInt(scaled.toString());
  };
}
/**
 * Converts decimal value into rescaled 64-bit unsigned integer
 * by scaling it up by specified number of decimal digits.
 *
 * Ensures that number won't accidentally become zero
 * or exceed U64's value range
 *
 * @param x         Decimal value to rescale
 * @param decimals  Number of decimal digits
 * @returns         Rescaled unsigned integer
 */
export const toScaledU64 = makeToScaledBigUint({
  bits: 64,
  precision: 20,
  exponent: 28,
});
/**
 * Converts decimal value into rescaled 128-bit unsigned integer
 * by scaling it up by specified number of decimal digits.
 *
 * Ensures that number won't accidentally become zero
 * or exceed U128's value range
 *
 * @param x         Decimal value to rescale
 * @param decimals  Number of decimal digits
 * @returns         Rescaled unsigned integer
 */
export const toScaledU128 = makeToScaledBigUint({
  bits: 128,
  precision: 40,
  exponent: 56,
});

/**
 * Decodes any protobuf message from a length-delimited format,
 * i.e. prefixed with its length encoded as varint
 *
 * @param   bytes  Byte array with encoded message
 * @param   schema Message schema for decoding
 * @returns        Decoded message
 */
export function decodeLengthDelimited<T extends Message>(
  bytes: Uint8Array,
  schema: GenMessage<T>,
): T {
  // use sizeDelimitedPeek to extract the message length and offset
  const peekResult = sizeDelimitedPeek(bytes);

  if (peekResult.size === null || peekResult.offset === null) {
    throw new Error("Failed to parse size-delimited message");
  }

  if (peekResult.size > MAX_PAYLOAD_SIZE) {
    throw new Error(
      `Encoded message size (${peekResult.size} bytes) is greater than max payload size (${MAX_PAYLOAD_SIZE} bytes).`,
    );
  }

  if (peekResult.offset + peekResult.size > bytes.length) {
    throw new Error(
      `Encoded message size (${peekResult.size} bytes) is greater than remaining buffer size (${bytes.length - peekResult.offset} bytes).`,
    );
  }

  // decode the message using the offset and size from peek
  return fromBinary(
    schema,
    bytes.slice(peekResult.offset, peekResult.offset + peekResult.size),
  );
}

export function checkPubKeyLength(keyType: KeyType, len: number): void {
  if (keyType === KeyType.Bls12_381) {
    throw new Error(
      "Cannot create a user using Bls12_381, use Ed25119 or Secp256k1 instead.",
    );
  }

  if (len !== 32 && keyType === KeyType.Ed25519) {
    throw new Error("Ed25519 pubkeys must be 32 length.");
  }

  if (len !== 33 && keyType === KeyType.Secp256k1) {
    throw new Error("Secp256k1 pubkeys must be 33 length.");
  }
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

export function keypairFromPrivateKey(
  privateKey: string | Uint8Array,
): Keypair {
  if (typeof privateKey === "string") {
    if (!privateKey.startsWith("0x")) {
      return Keypair.fromSecretKey(bs58.decode(privateKey));
    }
    const hex = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
    const bytes = new Uint8Array(
      hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
    );
    return Keypair.fromSecretKey(bytes);
  }
  return Keypair.fromSecretKey(privateKey);
}
