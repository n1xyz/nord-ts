import { ethers } from "ethers";
import WebSocket from "ws";
import {
  ActionInfo,
  ActionsExtendedInfo,
  ActionQuery,
  ActionResponse,
  ActionsResponse,
  AggregateMetrics,
  BlockQuery,
  BlockResponse,
  BlockSummaryResponse,
  type DeltaEvent,
  ERC20TokenInfo,
  type Info,
  type Market,
  NordConfig,
  PeakTpsPeriodUnit,
  RollmanActionResponse,
  RollmanActionsResponse,
  RollmanBlockResponse,
  MarketsStatsResponse,
  type SubscriberConfig,
  type Token,
  type Trades,
  type Account,
} from "../types";
import { checkedFetch, decodeLengthDelimited, MAX_BUFFER_LEN } from "../utils";
import {
  DEV_TOKEN_INFOS,
  EVM_DEV_URL,
  WEBSERVER_DEV_URL,
  DEV_CONTRACT_ADDRESS,
} from "../const";
import { ERC20_ABI, NORD_RAMP_FACET_ABI } from "../abis";
import * as proto from "../gen/nord";
import { DefaultNordImpl, NordImpl } from "./NordImpl";

export async function depositOnlyTx(
  privateAddress: string,
  publicKey: Uint8Array,
  amount: number,
  precision: number,
  contractAddress: string,
): Promise<string> {
  const provider = new ethers.JsonRpcProvider(process.env.SECRET_FAUCET_RPC);
  const wallet = new ethers.Wallet(privateAddress, provider);
  const nordContract = new ethers.Contract(
    contractAddress,
    NORD_RAMP_FACET_ABI,
    wallet,
  );
  const depositTx = await nordContract.depositUnchecked(
    publicKey,
    BigInt(0),
    ethers.parseUnits(amount.toString(), precision),
    {
      gasLimit: 1_000_000,
      maxFeePerGas: ethers.parseUnits("100", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("0.01", "gwei"),
    },
  );
  return depositTx.hash;
}

export async function depositOnlyTxRaw(
  privateAddress: string,
  publicKey: Uint8Array,
  amount: number,
  precision: number,
  contractAddress: string,
): Promise<string> {
  const provider = new ethers.JsonRpcProvider(process.env.SECRET_FAUCET_RPC);
  const wallet = new ethers.Wallet(privateAddress, provider);
  const nordContract = new ethers.Contract(
    contractAddress,
    NORD_RAMP_FACET_ABI,
    wallet,
  );
  const depositTx = await nordContract.depositUnchecked.populateTransaction(
    publicKey,
    BigInt(0),
    ethers.parseUnits(amount.toString(), precision),
    {
      maxFeePerGas: ethers.parseUnits("0.0003", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("0.0003", "gwei"),
    },
  );
  return JSON.stringify(depositTx);
}

export class Nord {
  impl: NordImpl = DefaultNordImpl;
  evmUrl: string;
  webServerUrl: string;
  contractAddress: string;
  tokenInfos: ERC20TokenInfo[];
  markets: Market[];
  tokens: Token[];

  constructor({
    evmUrl,
    webServerUrl,
    tokenInfos,
    contractAddress,
  }: NordConfig) {
    this.evmUrl = evmUrl;
    this.webServerUrl = webServerUrl;
    this.tokenInfos = tokenInfos;
    this.contractAddress = contractAddress;
    this.markets = [];
    this.tokens = [];
  }

  async getTimestamp(): Promise<bigint> {
    const resp = await (
      await checkedFetch(`${this.webServerUrl}/timestamp`, { method: "GET" })
    ).json();
    return BigInt(resp);
  }

  async getActionNonce(): Promise<number> {
    const resp = await (
      await checkedFetch(`${this.webServerUrl}/action_nonce`, { method: "GET" })
    ).json();
    return resp as number;
  }

  async fetchNordInfo() {
    const response = await checkedFetch(`${this.webServerUrl}/info`, {
      method: "GET",
    });
    const info: Info = await response.json();
    this.markets = info.markets;
    this.tokens = info.tokens;
  }

  public static async initNord(nordConfig: NordConfig): Promise<Nord> {
    const nord = new Nord(nordConfig);
    await nord.fetchNordInfo();
    return nord;
  }

  public static async initDevNord(): Promise<Nord> {
    const nord = new Nord({
      evmUrl: EVM_DEV_URL,
      webServerUrl: WEBSERVER_DEV_URL,
      tokenInfos: DEV_TOKEN_INFOS,
      contractAddress: DEV_CONTRACT_ADDRESS,
    });
    await nord.fetchNordInfo();
    return nord;
  }

  public async marketsStats(): Promise<MarketsStatsResponse> {
    const response = await checkedFetch(`${this.webServerUrl}/stats`, {
      method: "GET",
    });
    const stats: MarketsStatsResponse = await response.json();
    return stats;
  }

  // Query the block info from rollman.
  async queryBlock(query: BlockQuery): Promise<BlockResponse> {
    const rollmanResponse: RollmanBlockResponse =
      await this.blockQueryRollman(query);
    const queryResponse: BlockResponse = {
      block_number: rollmanResponse.block_number,
      actions: [],
    };

    for (const rollmanAction of rollmanResponse.actions) {
      const blockAction: ActionInfo = {
        action_id: rollmanAction.action_id,
        action: decodeLengthDelimited(
          new Uint8Array(rollmanAction.action_pb),
          proto.Action,
        ),
      };
      queryResponse.actions.push(blockAction);
    }
    return queryResponse;
  }

  // Query the block info from rollman.
  async queryLastNBlocks(): Promise<BlockResponse> {
    const rollmanResponse: RollmanBlockResponse = await this.blockQueryRollman(
      {},
    );
    const queryResponse: BlockResponse = {
      block_number: rollmanResponse.block_number,
      actions: [],
    };
    for (const rollmanAction of rollmanResponse.actions) {
      const blockAction: ActionInfo = {
        action_id: rollmanAction.action_id,
        action: decodeLengthDelimited(rollmanAction.action_pb, proto.Action),
      };
      queryResponse.actions.push(blockAction);
    }
    return queryResponse;
  }

  // Query the block summary of recent blocks from rollman.
  async queryRecentBlocks(last_n: number): Promise<BlockSummaryResponse> {
    const response: BlockSummaryResponse =
      await this.blockSummaryQueryRollman(last_n);
    return response;
  }

  // Query the action info from rollman.
  async queryAction(query: ActionQuery): Promise<ActionResponse> {
    const rollmanResponse: RollmanActionResponse =
      await this.actionQueryRollman(query);
    return {
      block_number: rollmanResponse.block_number,
      action: decodeLengthDelimited(rollmanResponse.action_pb, proto.Action),
    };
  }

  // Query the recent transactions from rollman.
  async queryRecentActions(last_n: number): Promise<ActionsResponse> {
    const rollmanResponse: RollmanActionsResponse =
      await this.actionsQueryRollman(last_n);

    const queryResponse: ActionsResponse = {
      actions: [],
    };
    for (const rollmanExtendedAction of rollmanResponse.actions) {
      const extendedActionInfo: ActionsExtendedInfo = {
        block_number: rollmanExtendedAction.block_number,
        action_id: rollmanExtendedAction.action_id,
        action: decodeLengthDelimited(
          rollmanExtendedAction.action_pb,
          proto.Action,
        ),
      };
      queryResponse.actions.push(extendedActionInfo);
    }
    return queryResponse;
  }

  // Query the aggregate metrics across nord and rollman.
  async aggregateMetrics(
    txPeakTpsPeriod = 1,
    txPeakTpsPeriodUnit: PeakTpsPeriodUnit = PeakTpsPeriodUnit.Day,
  ): Promise<AggregateMetrics> {
    // Get the latest block number for L2 blocks.
    const blockQuery: BlockQuery = {};
    const rollmanResponse: RollmanBlockResponse =
      await this.blockQueryRollman(blockQuery);

    const period = txPeakTpsPeriod.toString() + txPeakTpsPeriodUnit;
    const query = `max_over_time(rate(nord_requests_ok_count[1m])[${period}:1m])`;

    return {
      blocks_total: rollmanResponse.block_number,
      tx_total: await this.queryPrometheus("nord_requests_ok_count"),
      tx_tps: await this.getCurrentTps(),
      tx_tps_peak: await this.queryPrometheus(query),
      request_latency_average: await this.queryPrometheus(
        'nord_requests_ok_latency{quantile="0.5"}',
      ),
    };
  }

  async getCurrentTps(period: string = "1m") {
    return await this.queryPrometheus(
      "rate(nord_requests_ok_count[" + period + "])",
    );
  }

  async getPeakTps(period: string = "24h") {
    return await this.queryPrometheus(
      "max_over_time(rate(nord_requests_ok_count[30s])[" + period + ":])",
    );
  }

  async getMedianLatency(period: string = "1m") {
    return await this.queryPrometheus(
      `avg_over_time(nord_requests_ok_latency{quantile="0.5"}[${period}])`,
    );
  }

  async getTotalTransactions() {
    return await (
      await checkedFetch(this.webServerUrl + "/last_actionid")
    ).text();
  }

  // Helper to query rollman for block info.
  async blockQueryRollman(query: BlockQuery): Promise<RollmanBlockResponse> {
    let url = this.webServerUrl + "/block_query";
    if (query.block_number != null) {
      url = url + "?block_number=" + query.block_number;
    }
    const response = await checkedFetch(url);
    if (!response.ok) {
      throw new Error("Rollman query failed " + url);
    }
    return await response.json();
  }

  // Helper to query rollman for recent block summary.
  async blockSummaryQueryRollman(
    last_n: number,
  ): Promise<BlockSummaryResponse> {
    const url = this.webServerUrl + "/last_n_blocks?last_n=" + last_n;
    const response = await checkedFetch(url);
    if (!response.ok) {
      throw new Error("Rollman query failed " + url);
    }
    return await response.json();
  }

  // Helper to query rollman for action info.
  async actionQueryRollman(query: ActionQuery): Promise<RollmanActionResponse> {
    const url = this.webServerUrl + "/tx_query?action_id=" + query.action_id;
    const response = await checkedFetch(url);
    if (!response.ok) {
      throw new Error("Rollman query failed " + url);
    }
    return await response.json();
  }

  // Helper to query rollman for recent actions.
  async actionsQueryRollman(last_n: number): Promise<RollmanActionsResponse> {
    const url = this.webServerUrl + "/last_n_actions?last_n=" + last_n;
    const response = await checkedFetch(url);
    if (!response.ok) {
      throw new Error("Rollman query failed " + url);
    }
    return await response.json();
  }

  // Helper to query prometheus.
  async queryPrometheus(params: string): Promise<number> {
    const url = this.webServerUrl + "/prometheus_query?query=" + params;
    const response = await checkedFetch(url);
    if (!response.ok) {
      throw new Error("Prometheus query failed " + url);
    }
    const json = await response.json();
    // Prometheus HTTP API: https://prometheus.io/docs/prometheus/latest/querying/api/
    return Number(json.data.result[0].value[1]);
  }

  static async approveTx(
    privateAddress: string,
    erc20address: string,
    contractAddress: string,
  ): Promise<void> {
    const provider = new ethers.JsonRpcProvider(process.env.SECRET_FAUCET_RPC);
    const wallet = new ethers.Wallet(privateAddress, provider);
    const erc20Contract = new ethers.Contract(erc20address, ERC20_ABI, wallet);

    const maxUint256 = ethers.MaxUint256;
    const approveTx = await erc20Contract.approve(
      contractAddress,
      maxUint256.toString(),
      {
        maxFeePerGas: ethers.parseUnits("30", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("0.001", "gwei"),
      },
    );
    return approveTx.hash;
  }
}

export class Subscriber {
  streamURL: string;
  buffer: (DeltaEvent | Trades | Account)[];
  maxBufferLen: number;

  constructor(config: SubscriberConfig) {
    this.streamURL = config.streamURL;
    this.buffer = [];
    this.maxBufferLen = config.maxBufferLen ?? MAX_BUFFER_LEN;
  }

  subscribe(): void {
    const ws = new WebSocket(this.streamURL);

    ws.on("open", () => {});

    ws.on("message", (rawData) => {
      const message: string = rawData.toLocaleString();
      const event: DeltaEvent | Trades | Account = JSON.parse(message);
      this.buffer.push(event);
      if (this.buffer.length > this.maxBufferLen) {
        this.buffer.shift();
      }
    });

    ws.on("close", () => {});
  }
}
