import { Decimal } from "decimal.js";
import * as proto from "./gen/action";
import { ed25519 } from "@noble/curves/ed25519";
import { bls12_381 as bls } from "@noble/curves/bls12-381";
import { secp256k1 as secp } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { ActionKind, ActionKindTag, KeyType } from "./types";
import fetch from "node-fetch";

export const ZERO_DECIMAL = new Decimal(0);

const MAX_MANTISSA = BigInt(2) ** BigInt(96) - BigInt(1);
const MAX_DECIMAL_SCALE = 28;
const NORD_URL = "http://localhost:3000/action";

const NEG_BIT = 128; // 0b1000_0000
const MAX_PAYLOAD_SIZE = 100 * 1000; // 100 kB

/**
 * Sends a post request to the defined NORD_URL endpoint.
 * @param payload - The message data to send.
 * @returns Response data in JSON format.
 */
export async function sendMessage(payload: Uint8Array): Promise<any> {
  try {
    const response = await fetch(NORD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: payload,
    });
    return response.json();
  } catch (e: any) {
    return e;
  }
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
  if (keyType === KeyType.Ed25119) {
    sig = ed25519.sign(action, sk);
  } else if (keyType === KeyType.Bls12_381) {
    sig = bls.signShortSignature(action, sk);
  } else if (keyType === KeyType.Secp256k1) {
    sig = secp.sign(sha256(action), sk).toCompactRawBytes();
  } else {
    throw new Error("Invalid key type");
  }
  return new Uint8Array([...action, ...sig]);
}

/**
 * Converts a Decimal type to a protobuf Decimal format.
 * @param x - Decimal value to convert.
 * @returns Encoded Decimal in protobuf format.
 */
export function toPbDecimal(x: Decimal): proto.Action_Decimal {
  Decimal.set({ toExpPos: 29, toExpNeg: -29 });

  let strX = x.toString();
  let isNeg: boolean = false;

  if (x.isNeg()) {
    isNeg = true;
    strX = strX.substring(1);
  }

  const scale = x.dp();
  if (scale > MAX_DECIMAL_SCALE) {
    throw new Error("Cannot input a decimal with more than 28 d.p.");
  }

  let mantissa: bigint;
  if (scale > 0) {
    mantissa = BigInt(strX.toString().replace(".", ""));
  } else {
    mantissa = BigInt(strX.toString());
  }
  if (mantissa > MAX_MANTISSA) {
    throw new Error("Mantissa has to be <= 2^96 - 1");
  }

  let bits = mantissa.toString(2);
  if (bits.length < 96) {
    bits = bits.padStart(96, "0");
  }

  let firstByte = scale;
  if (isNeg) {
    firstByte |= NEG_BIT;
  }

  let mantissaBuf = bigintToBuf(mantissa).reverse(); // little-endian

  let cc = Buffer.concat([Uint8Array.from([firstByte]), mantissaBuf]);

  return proto.Action_Decimal.create({
    encodedDecimal: cc,
  });
}

function bigintToBuf(a: bigint): Uint8Array {
  if (a < 0)
    throw RangeError(
      "a should be a non-negative integer. Negative values are not supported",
    );
  return hexToBuf(a.toString(16));
}

function hexToBuf(hexStr: string): Uint8Array {
  let hex = parseHex(hexStr);
  hex = parseHex(hexStr, Math.ceil(hex.length / 2)); // pad to have a length in bytes
  return Uint8Array.from(
    hex.match(/[\da-fA-F]{2}/g)!.map((h) => {
      // eslint-disable-line
      return parseInt(h, 16);
    }),
  );
}

function parseHex(a: string, byteLength?: number): string {
  const hexMatch = a.match(/^(0x)?([\da-fA-F]+)$/);
  if (hexMatch == null) {
    throw new RangeError(
      "Input must be a hexadecimal string, e.g. '0x124fe3a' or '0214f1b2'.",
    );
  }
  let hex = hexMatch[2];
  if (byteLength !== undefined) {
    if (byteLength < hex.length / 2) {
      throw new RangeError(
        `Expected byte length ${byteLength} < input hex byte length ${Math.ceil(
          hex.length / 2,
        )}.`,
      );
    }
    hex = hex.padStart(byteLength * 2, "0");
  }
  return hex;
}

/**
 * Creates a proto.Action object.
 * @param actionKind - the ActionKind to set for the proto.Action object.
 * @param setAction - tag that must be set if ActionKind === (proto.Action_Deposit || proto.Action_Withdraw) to differentiate between the action kinds.
 * @returns A new proto.Action object.
 */
export function createAction(actionKind: ActionKind): proto.Action {
  const action = proto.Action.create({
    currentTimestamp: getCurrentTimestamp(),
    nonce: getNonce(),
  });

  if (actionKind.tag === ActionKindTag.CreateUser)
    action.createUser = actionKind;
  else if (actionKind.tag === ActionKindTag.CreateSession)
    action.createSession = actionKind;
  else if (actionKind.tag === ActionKindTag.Deposit)
    action.deposit = actionKind;
  else if (actionKind.tag === ActionKindTag.Withdraw)
    action.withdraw = actionKind;
  else if (actionKind.tag === ActionKindTag.PlaceOrder)
    action.placeOrder = actionKind;
  else if (actionKind.tag === ActionKindTag.CancelOrderById)
    action.cancelOrderById = actionKind;
  else throw Error("Invalid action kind tag.");

  return action;
}

/**
 * Encodes an Action in length-delimited format.
 * @param a - Action object to encode.
 * @returns Encoded Action as Uint8Array.
 */
export function encodeDelimited(a: proto.Action): Uint8Array {
  const e = proto.Action.encode(a).finish();
  if (e.byteLength > MAX_PAYLOAD_SIZE) {
    throw new Error("Encoded action can't be greater than 100 kB.");
  }
  return new Uint8Array([...toVarint(e.byteLength), ...e]);
}

/**
 * Converts an integer to its varint representation.
 * @param x - Integer to encode.
 * @returns Encoded integer as a varint Uint8Array.
 */
export function toVarint(x: number): Uint8Array {
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

  let r: number[] = [];
  while (x !== 0) {
    r.push(x & 0b1111111);
    x >>= 7;
  }

  for (let i = 0; i < r.length - 1; i += 1) {
    r[i] |= 1 << 7;
  }

  return Uint8Array.from(r);
}

/**
 * Retrieves the current timestamp.
 * @returns Current timestamp as a bigint.
 */
export function getCurrentTimestamp(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

let _lastTs = 0;
let _lastNonce = 0;
/**
 * Generates a nonce based on the current timestamp.
 * @returns Generated nonce as a number.
 */
export function getNonce(): number {
  let ts = Date.now() / 1000;
  if (ts === _lastTs) {
    _lastNonce += 1;
  } else {
    _lastTs = ts;
    _lastNonce = 0;
  }
  return _lastNonce;
}
