import { Decimal } from "decimal.js";
import { ed25519 } from "@noble/curves/ed25519";
import { bls12_381 as bls } from "@noble/curves/bls12-381";
import { secp256k1 as secp } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import fetch from "node-fetch";
import { KeyType, type Market, type Token } from "./types";
import * as proto from "./gen/nord";

export const SESSION_TTL = 10 * 60;
export const ZERO_DECIMAL = new Decimal(0);
export const MAX_BUFFER_LEN = 10_000;

const NORD_URL = "http://localhost:3000/action";
const MAX_PAYLOAD_SIZE = 100 * 1000; // 100 kB

/**
 * Query the transactions in the specified L2 block.
 * @field {number} block_number specifies the block number to query.
 *                 If not specified, transactions from latest block
 *                 are returned.
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
 * Query the action for the specified action id.
 * @field {number} action_id specifies the action to query.
 */
export interface ActionQuery {
  action_id: number;
}

/**
 * Response for ActionQuery.
 * @field {number} block_number the block the action is part of.
 *                 If the action is not yet included in any block,
 *                 null is returned.
 * @field {Action} action in protobuf format.
 */
export interface ActionQueryResponse {
  block_number?: number;
  action: proto.nord.Action;
}

/**
 * Info about the block transaction.
 * @field {number} action_id is the action identifier.
 * @field {Action} action in protobuf format.
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

interface RollmanActionQueryResponse {
  block_number?: number;
  action_pb: Uint8Array;
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

export class NordMetrics {
  private readonly rollmanUrl: string;
  private readonly prometheusUrl: string;

  constructor({
    rollmanUrl,
    prometheusUrl,
  }: Readonly<{ rollmanUrl: string; prometheusUrl: string }>) {
    this.rollmanUrl = rollmanUrl;
    this.prometheusUrl = `${prometheusUrl  }/api/v1/query`;
  }

  // Query the block info from rollman.
  async queryBlock(query: BlockQuery): Promise<BlockQueryResponse> {
    const rollmanResponse: RollmanBlockQueryResponse =
      await this.blockQueryRollman(query);
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

  // Query the action info from rollman.
  async queryAction(query: ActionQuery): Promise<ActionQueryResponse> {
    const rollmanResponse: RollmanActionQueryResponse =
      await this.actionQueryRollman(query);
    const queryResponse: ActionQueryResponse = {
      block_number: rollmanResponse.block_number,
      action: decodeActionDelimited(rollmanResponse.action_pb),
    };
    return queryResponse;
  }

  // Query the aggregate metrics across nord and rollman.
  async aggregateMetrics(): Promise<AggregateMetrics> {
    // Get the latest block number for L2 blocks.
    const blockQuery: BlockQuery = {};
    const rollmanResponse: RollmanBlockQueryResponse =
      await this.blockQueryRollman(blockQuery);

    const metrics: AggregateMetrics = {
      blocks_total: rollmanResponse.block_number,
      tx_total: await this.queryPrometheus("nord_requests_count"),
      tx_tps: await this.queryPrometheus("rate(nord_requests_count[1m])"),
      tx_tps_peak: 99, // TODO
      request_latency_average: await this.queryPrometheus(
        'nord_requests_latency{quantile="0.5"}',
      ),
    };
    return metrics;
  }

  // Helper to query rollman for block info.
  async blockQueryRollman(
    query: BlockQuery,
  ): Promise<RollmanBlockQueryResponse> {
    let url = `${this.rollmanUrl  }/block`;
    if (query.block_number != null) {
      url = `${url  }?block_number=${  query.block_number}`;
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Rollman query failed ${  url}`);
    }
    const rollmanResponse: RollmanBlockQueryResponse = await response.json();
    return rollmanResponse;
  }

  // Helper to query rollman for action info.
  async actionQueryRollman(
    query: ActionQuery,
  ): Promise<RollmanActionQueryResponse> {
    const url = `${this.rollmanUrl  }/action?action_id=${  query.action_id}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Rollman query failed ${  url}`);
    }
    const rollmanResponse: RollmanActionQueryResponse = await response.json();
    return rollmanResponse;
  }

  // Helper to query prometheus.
  async queryPrometheus(params: string): Promise<number> {
    const url = `${this.prometheusUrl  }?query=${  params}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Prometheus query failed ${  url}`);
    }
    const json = await response.json();
    // Prometheus HTTP API: https://prometheus.io/docs/prometheus/latest/querying/api/
    return Number(json.data.result[0].value[1]);
  }
}
