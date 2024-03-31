import fetch from "node-fetch";
import WebSocket from "ws";
import {
    ActionInfo,
    ActionQuery,
    ActionQueryResponse,
    AggregateMetrics,
    BlockQuery,
    BlockQueryResponse,
    type DeltaEvent,
    ERC20TokenInfo,
    type Info,
    type Market,
    NordConfig,
    PeakTpsPeriodUnit,
    RollmanActionQueryResponse,
    RollmanBlockQueryResponse,
    type SubscriberConfig,
    type Token,
} from "../types";
import {decodeActionDelimited, MAX_BUFFER_LEN} from "../utils";
import {DEV_TOKEN_INFOS, EVM_DEV_URL, NORD_DEV_URL, PROMETHEUS_DEV_URL, ROLLMAN_DEV_URL} from "../const";

export class Nord {
    nordUrl: string;
    evmUrl: string;
    prometheusUrl: string;
    rollmanUrl: string;
    tokenInfos: ERC20TokenInfo[];
    markets: Market[];
    tokens: Token[];

    constructor({nordUrl, evmUrl, prometheusUrl, rollmanUrl, tokenInfos}: NordConfig) {
        this.nordUrl = nordUrl;
        this.evmUrl = evmUrl;
        this.prometheusUrl = prometheusUrl + "/api/v1/query";
        this.rollmanUrl = rollmanUrl;
        this.tokenInfos = tokenInfos;
        this.markets = [];
        this.tokens = [];
    }

    async fetchNordInfo() {
        const response = await fetch(`${this.nordUrl}/info`, {method: "GET"});
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
            nordUrl: NORD_DEV_URL,
            prometheusUrl: PROMETHEUS_DEV_URL,
            rollmanUrl: ROLLMAN_DEV_URL,
            tokenInfos: DEV_TOKEN_INFOS
        });
        await nord.fetchNordInfo();
        return nord;
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
        return {
            block_number: rollmanResponse.block_number,
            action: decodeActionDelimited(rollmanResponse.action_pb),
        };
    }

    // Query the aggregate metrics across nord and rollman.
    async aggregateMetrics(
        txPeakTpsPeriod: number,
        txPeakTpsPeriodUnit: PeakTpsPeriodUnit,
    ): Promise<AggregateMetrics> {
        // Get the latest block number for L2 blocks.
        const blockQuery: BlockQuery = {};
        const rollmanResponse: RollmanBlockQueryResponse =
            await this.blockQueryRollman(blockQuery);
        const period = txPeakTpsPeriod.toString() + txPeakTpsPeriodUnit;
        const query = `max_over_time(rate(nord_requests_count[1m])[${period}:1m])`;

        return {
            blocks_total: rollmanResponse.block_number,
            tx_total: await this.queryPrometheus("nord_requests_count"),
            tx_tps: await this.queryPrometheus("rate(nord_requests_count[1m])"),
            tx_tps_peak: await this.queryPrometheus(query),
            request_latency_average: await this.queryPrometheus(
                'nord_requests_latency{quantile="0.5"}',
            ),
        };
    }

    // Helper to query rollman for block info.
    async blockQueryRollman(
        query: BlockQuery,
    ): Promise<RollmanBlockQueryResponse> {
        let url = this.rollmanUrl + "/block";
        if (query.block_number != null) {
            url = url + "?block_number=" + query.block_number;
        }
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error("Rollman query failed " + url);
        }
        return await response.json();
    }

    // Helper to query rollman for action info.
    async actionQueryRollman(
        query: ActionQuery,
    ): Promise<RollmanActionQueryResponse> {
        const url = this.rollmanUrl + "/action?action_id=" + query.action_id;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error("Rollman query failed " + url);
        }
        return await response.json();
    }

    // Helper to query prometheus.
    async queryPrometheus(params: string): Promise<number> {
        const url = this.prometheusUrl + "?query=" + params;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error("Prometheus query failed " + url);
        }
        const json = await response.json();
        // Prometheus HTTP API: https://prometheus.io/docs/prometheus/latest/querying/api/
        return Number(json.data.result[0].value[1]);
    }
}

export class Subscriber {
    streamURL: string;
    buffer: DeltaEvent[];
    maxBufferLen: number;

    constructor(config: SubscriberConfig) {
        this.streamURL = config.streamURL;
        this.buffer = [];
        this.maxBufferLen = config.maxBufferLen ?? MAX_BUFFER_LEN;
    }


    private lastTs = 0;
    private lastNonce = 0;

    /**
     * Generates a nonce based on the current timestamp.
     * @returns Generated nonce as a number.
     */
    getNonce(): number {
        const ts = Date.now() / 1000;
        if (ts === this.lastTs) {
            this.lastNonce += 1;
        } else {
            this.lastTs = ts;
            this.lastNonce = 0;
        }
        return this.lastNonce;
    }

    subscribe(): void {
        const ws = new WebSocket(this.streamURL);

        ws.on("open", () => {
            console.log(`Connected to ${this.streamURL}`);
        });

        ws.on("message", (rawData) => {
            const message: string = rawData.toLocaleString();
            const event: DeltaEvent = JSON.parse(message);
            if (!this.checkEvent(event)) {
                return;
            }
            this.buffer.push(event);
            if (this.buffer.length > this.maxBufferLen) {
                this.buffer.shift();
            }
        });

        ws.on("close", () => {
            console.log(`Disconnected from ${this.streamURL}`);
        });
    }

    checkEvent(_event: DeltaEvent): boolean {
        return true;
    }
}
