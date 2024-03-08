import { Decimal } from "decimal.js";
import * as proto from "./gen/nord";
import { ed25519 } from "@noble/curves/ed25519";
import { bls12_381 as bls } from "@noble/curves/bls12-381";
import { secp256k1 as secp } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { KeyType, type Market, type Token } from "./types";
import fetch from "node-fetch";

export const SESSION_TTL = 10 * 60;
export const ZERO_DECIMAL = new Decimal(0);
export const MAX_BUFFER_LEN = 10_000;

const NORD_URL = "http://localhost:3000/action";
const MAX_PAYLOAD_SIZE = 100 * 1000; // 100 kB

const ROLLMAN_URL = "http://localhost:9248/block_query";
const PROMETHEUS_URL = "http://localhost:9090/api/v1/query";

/**
 * Query the transactions in the specified L2 block.
 * @field {number} block_number specifies the block number to query.
 *                 If not specified, transactions from latest block
                   are returned.
 */
export interface BlockQuery {
  block_number?: number;
}

/**
 * Response for BlockQuery.
 * @field {number} block_number specifies the block number being returned.
 * @field {BlockActions} actions are the list of transactions from the block.
 */
export interface BlockQueryResponse {
  block_number: number;
  actions: ActionInfo[];
}

/**
 * Info about the block transaction.
 * @field {number} action_id is the action identifier.
 * @field {Action} action is the action.
 */
export interface ActionInfo {
  action_id: number;
  action: proto.nord.Action;
}

/**
 * Aggregate metrics
 * @field {number} blocks_total: Total number of L2 blocks.
 * @field {number} tx_total: Total number of transactions.
 * @field {number} tx_tps: Transaction throughput.
 * @field {number} tx_tps_peak: Peak transaction throughput.
 * @field {number} request_latency_average: Average request latency.
 */
export interface AggregateMetrics {
  blocks_total: number;
  tx_total: number;
  tx_tps: number;
  tx_tps_peak: number;
  request_latency_average: number;
}

// The formats returned by rollman.
interface RollmanBlockQueryResponse {
  block_number: number;
  actions: RollmanActionInfo[];
}

interface RollmanActionInfo {
  action_id: number;
  action_pb: Uint8Array;
}

/**
 * Sends a post request to the defined NORD_URL endpoint.
 * @param payload - The message data to send.
 * @returns Response data in Uint8Array.
 */
export async function sendMessage(payload: Uint8Array): Promise<Uint8Array> {
  try {
    const response = await fetch(NORD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: payload,
    });
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
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
  return new Uint8Array([...toVarint(e.byteLength), ...e]);
}

/**
 * Decodes an Action in length-delimited format.
 * @param u - Encoded Action as Uint8Array to decode.
 * @returns Decoded Action as Uint8Array.
 */
function decodeActionDelimited(u: Uint8Array): proto.nord.Action {
  let index = 0;
  while (u[index] >> 7 > 0) {
    index++;
  }
  return proto.nord.Action.deserialize(u.slice(index + 1));
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

let _lastTs = 0;
let _lastNonce = 0;
/**
 * Generates a nonce based on the current timestamp.
 * @returns Generated nonce as a number.
 */
export function getNonce(): number {
  const ts = Date.now() / 1000;
  if (ts === _lastTs) {
    _lastNonce += 1;
  } else {
    _lastTs = ts;
    _lastNonce = 0;
  }
  return _lastNonce;
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

/**
 * Performs the block query.
 * @param query -Query params.
 * @returns the block transactions.
 */
export async function queryBlock(
  query: BlockQuery,
): Promise<BlockQueryResponse> {
  const rollmanResponse: RollmanBlockQueryResponse = await queryRollman(query);
  const queryResponse: BlockQueryResponse = {
    block_number: rollmanResponse.block_number,
    actions: [],
  };

  for (const rollmanAction of rollmanResponse.actions) {
    const blockAction: ActionInfo = {
      action_id: rollmanAction.action_id,
      action: decodeActionDelimited(rollmanAction.action_pb),
    };
    queryResponse.actions.push(blockAction);
  }
  return queryResponse;
}

/**
 * Gets the aggregate metrics.
 * @returns the aggregate metrics.
 */
export async function aggregateMetrics(): Promise<AggregateMetrics> {
  // Get the latest block number for L2 blocks.
  const blockQuery: BlockQuery = {};
  const rollmanResponse: RollmanBlockQueryResponse =
    await queryRollman(blockQuery);

  const metrics: AggregateMetrics = {
    blocks_total: rollmanResponse.block_number,
    tx_total: await queryPrometheus("nord_requests_count"),
    tx_tps: await queryPrometheus("rate(nord_requests_count[1m])"),
    tx_tps_peak: 99, // TODO
    request_latency_average: await queryPrometheus(
      'nord_requests_latency{quantile="0.5"}',
    ),
  };
  return metrics;
}

// Helper to query rollman.
async function queryRollman(
  query: BlockQuery,
): Promise<RollmanBlockQueryResponse> {
  let url = ROLLMAN_URL;
  if (query.block_number != null) {
    url = url + "?block_number=" + query.block_number;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Rollman query failed " + url);
  }
  const rollmanResponse: RollmanBlockQueryResponse = await response.json();
  return rollmanResponse;
}

// Helper to query prometheus.
async function queryPrometheus(params: string): Promise<number> {
  const url = PROMETHEUS_URL + "?query=" + params;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Prometheus query failed " + url);
  }
  const json = await response.json();
  // Prometheus HTTP API: https://prometheus.io/docs/prometheus/latest/querying/api/
  return Number(json.data.result[0].value[1]);
}
