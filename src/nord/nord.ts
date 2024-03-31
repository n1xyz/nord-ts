import {assert, findMarket, findToken, MAX_BUFFER_LEN,} from "../utils";
import {
    type ClientConfig,
    type DeltaEvent,
    type FillMode,
    type Info,
    type Market,
    Side,
    type SubsriberConfig,
    type Token,
} from "../types";
import fetch from "node-fetch";
import WebSocket from "ws";
import {CancelOrderAction, CreateSessionAction, DepositAction, PlaceOrderAction, WithdrawAction} from "./actions";
import {Hex} from "@noble/curves/src/abstract/utils";
import {ethers, SigningKey} from "ethers";
import {secp256k1} from "secp256k1";
import {DEFAULT_FUNDING_AMOUNTS, FAUCET_PRIVATE_ADDRESS} from "../const";
import {ERC20_ABI} from "../scs/abis/ERC20_ABI";

export class NordUser {
    nord: Nord;
    address: string;
    walletSignFn: (message: Hex) => Promise<string>;
    sessionSignFn: (message: Hex) => Promise<Uint8Array>;
    publicKey: string = "";
    userId: number = -1;
    sessionId: number = -1;

    get publicKeyPresent() {
        return this.publicKey != ""
    }

    constructor(
        nord: Nord,
        address: string,
        walletSignFn: (message: Hex) => Promise<string>,
        sessionSignFn: (message: Hex) => Promise<Uint8Array>,
        userId: number = -1,
        sessionId: number = -1
    ) {
        this.nord = nord;
        this.address = address;
        this.walletSignFn = walletSignFn;
        this.sessionSignFn = sessionSignFn;
        this.userId = userId;
        this.sessionId = sessionId;
    }

    async obtainPublicKey() {
        const message = "Layer N - Nord"
        const msgHash = ethers.hashMessage(message);
        const msgHashBytes = ethers.getBytes(msgHash);
        const signature = await this.walletSignFn(message)
        const recoveredPubKey = SigningKey.recoverPublicKey(msgHashBytes, signature);
        const publicKeyBuffer = Buffer.from(recoveredPubKey.slice(2), 'hex'); // Remove '0x' prefix and convert to Buffer
        this.publicKey = ethers.hashMessage(secp256k1.publicKeyConvert(publicKeyBuffer, true).slice(0, -2));
    }

    async fundWallet() {
        const provider = new ethers.JsonRpcProvider(this.nord.evmUrl);
        const wallet = new ethers.Wallet(FAUCET_PRIVATE_ADDRESS, provider);
        const ethTx = await wallet.sendTransaction({
            to: this.address,
            value: ethers.parseEther(DEFAULT_FUNDING_AMOUNTS['ETH'][0]!)
        });
        await ethTx.wait();
        for (const tokenAddress of this.nord.tokenAddresses) {
            const erc20Contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
            const defaultFundingAmount = DEFAULT_FUNDING_AMOUNTS[tokenAddress]!;
            const tokenTx = await erc20Contract.transfer(this.address, ethers.parseUnits(defaultFundingAmount[0], defaultFundingAmount[1]), {gasLimit: 1000000});
            tokenTx.wait();
        }

    }

    async refreshSession(
        sessionPk: Uint8Array,
    ): Promise<void> {
        assert(sessionPk.length === 32);

        const message = new CreateSessionAction(
            `${this.nord.nordUrl}/action`,
            sessionPk,
            this.walletSignFn,
            this.userId,
        );
        this.sessionId = await message.send();
    }

    async deposit(
        tokenId: number,
        amount: number
    ): Promise<void> {
        const message = new DepositAction(
            `${this.nord.nordUrl}/action`,
            this.sessionSignFn,
            findToken(this.nord.tokens, tokenId).decimals,
            tokenId,
            this.userId,
            amount,
        );

        await message.send();
    }

    async withdraw(
        tokenId: number,
        amount: number
    ): Promise<void> {
        const message = new WithdrawAction(
            `${this.nord.nordUrl}/action`,
            this.sessionSignFn,
            findToken(this.nord.tokens, tokenId).decimals,
            tokenId,
            this.userId,
            amount,
        );

        await message.send();
    }

    async placeOrder(
        marketId: number,
        side: Side,
        fillMode: FillMode,
        isReduceOnly: boolean,
        size: number,
        price?: number,
    ): Promise<number> {
        const message = new PlaceOrderAction(
            `${this.nord.nordUrl}/action`,
            this.sessionSignFn,
            findMarket(this.nord.markets, marketId).sizeDecimals,
            findMarket(this.nord.markets, marketId).priceDecimals,
            this.userId,
            this.sessionId,
            marketId,
            side,
            fillMode,
            isReduceOnly,
            size,
            price,
        );

        return await message.send();
    }

    async cancelOrder(
        marketId: number,
        orderId: number
    ): Promise<number> {
        const message = new CancelOrderAction(
            `${this.nord.nordUrl}/action`,
            this.sessionSignFn,
            this.userId,
            this.sessionId,
            marketId,
            orderId,
        );

        return await message.send();
    }
}

export class Nord {
    nordUrl: string;
    evmUrl: string;
    tokenAddresses: string[];
    markets: Market[];
    tokens: Token[];

    constructor(nordUrl: string, evmUrl: string, tokenAddresses: []) {
        this.nordUrl = nordUrl;
        this.evmUrl = evmUrl;
        this.tokenAddresses = [];
        this.markets = [];
        this.tokens = [];
    }

    public static async createClient({
                                         url,
                                         privateKey,
                                     }: ClientConfig): Promise<Nord> {
        const nord = new Nord(privateKey);
        nord.nordUrl = url;
        const pubkeyHex = Buffer.from(nord.publicKey).toString("hex");
        const response = await fetch(`${url}/info`, {method: "GET"});
        const info: Info = await response.json();
        const userId = await fetch(`${url}/user_id?pubkey=${pubkeyHex}`)
            .then(async (r) => await r.json())
            .then((u) => Number(u));
        nord.markets = info.markets;
        nord.tokens = info.tokens;
        nord.userId = userId;

        await nord.refreshSession(nord.userId);
        return nord;
    }
}

export class Subscriber {
    streamURL: string;
    buffer: DeltaEvent[];
    maxBufferLen: number;

    constructor(config: SubsriberConfig) {
        this.streamURL = config.streamURL;
        this.buffer = [];
        this.maxBufferLen = config.maxBufferLen ?? MAX_BUFFER_LEN;
    }

    subsribe(): void {
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

    checkEvent(event: DeltaEvent): boolean {
        return true;
    }
}
