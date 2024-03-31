import {Hex} from "@noble/curves/src/abstract/utils";
import {BrowserProvider, ethers, SigningKey} from "ethers";
//@ts-ignore
import {secp256k1} from "secp256k1";
import {DEFAULT_FUNDING_AMOUNTS, DEV_CONTRACT_ADDRESS, FAUCET_PRIVATE_ADDRESS} from "../const";
import {assert, findMarket, findToken} from "../utils";
import {ERC20_ABI} from "../scs/abis/ERC20_ABI";
import {CancelOrderAction, CreateSessionAction, PlaceOrderAction, WithdrawAction} from "./actions";
import {NORD_RAMP_FACET_ABI} from "../scs/abis/NORD_RAMP_FACET_ABI";
import {FillMode, Side} from "../types";
import {Nord} from "./Nord";

export class NordUser {
    nord: Nord;
    address: string;
    walletSignFn: (message: Hex) => Promise<string>;
    sessionSignFn: (message: Hex) => Promise<Uint8Array>;
    publicKey = "";
    userId = -1;
    sessionId = -1;

    get publicKeyPresent() {
        return this.publicKey != ""
    }

    constructor(
        nord: Nord,
        address: string,
        walletSignFn: (message: Hex) => Promise<string>,
        sessionSignFn: (message: Hex) => Promise<Uint8Array>,
        userId = -1,
        sessionId = -1
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
        assert(DEFAULT_FUNDING_AMOUNTS['ETH'] != null);
        const ethTx = await wallet.sendTransaction({
            to: this.address,
            value: ethers.parseEther(DEFAULT_FUNDING_AMOUNTS['ETH'][0])
        });
        await ethTx.wait();
        for (const tokenInfo of this.nord.tokenInfos) {
            const erc20Contract = new ethers.Contract(tokenInfo.address, ERC20_ABI, wallet);
            const defaultFundingAmount = DEFAULT_FUNDING_AMOUNTS[tokenInfo.address];
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
        provider: BrowserProvider,
        amount: number,
        tokenId: number
    ): Promise<void> {
        if (tokenId || tokenId == 0) {
            const erc20 = this.nord.tokenInfos[tokenId];
            const erc20Contract = new ethers.Contract(erc20.address, ERC20_ABI, await provider.getSigner());
            const approveTx = await erc20Contract.approve(DEV_CONTRACT_ADDRESS, ethers.parseUnits(amount.toString(), erc20.precision), {gasLimit: 1000000});
            await approveTx.wait();
        } else {
            const nordContract = new ethers.Contract(DEV_CONTRACT_ADDRESS, NORD_RAMP_FACET_ABI, await provider.getSigner());
            const depositTx = await nordContract.depositUnchecked(this.publicKey, BigInt(0), ethers.parseUnits(amount.toString(), 6), {gasLimit: 1000000});
            await depositTx.wait();
        }
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
