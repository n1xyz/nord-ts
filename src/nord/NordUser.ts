import {Hex} from "@noble/curves/src/abstract/utils";
import {BrowserProvider, ethers, SigningKey} from "ethers";
import secp256k1 from "secp256k1";
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
    sessionSignFn: (message: Uint8Array) => Promise<Uint8Array>;
    userId = -1;
    sessionId = -1;


    publicKey = "";
    lastTs = 0;
    lastNonce = 0;

    clone(): NordUser {
        const newUser = new NordUser(
            this.nord,
            this.address,
            this.walletSignFn,
            this.sessionSignFn,
            this.userId,
            this.sessionId
        )
        newUser.publicKey = this.publicKey
        newUser.lastTs = this.lastTs
        newUser.lastNonce = this.lastNonce
        return newUser
    }

    get publicKeyPresent() {
        return this.publicKey != ""
    }


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

    constructor(
        nord: Nord,
        address: string,
        walletSignFn: (message: Hex) => Promise<string>,
        sessionSignFn: (message: Uint8Array) => Promise<Uint8Array>,
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

    async updateUserId() {
        await this.setPublicKey();
        const userId: any = await (await fetch('http://localhost:3000/user_id?pubkey=0383135b54105d4a7aae60c08fc45f9687181b4fdfc625bd1a753fa7397fed75')).json() as {
            error: string
        } | number
        if (isNaN(userId)) {
            if (userId.error == 'INTERNAL_SERVER_ERROR') {
                this.userId = -1;
                return;
            }
            throw new Error("Could not fetch user id!")
        }
        this.userId = userId as number
    }

    async setPublicKey() {
        const publicKeyBuffer = await NordUser.extractPublicKey(this.walletSignFn);
        this.publicKey = ethers.hashMessage(secp256k1.publicKeyConvert(publicKeyBuffer, true).slice(0, -2));
    }

    static async extractPublicKey(walletSignFn: (message: Hex) => Promise<string>) {
        const message = "Layer N - Nord"
        const msgHash = ethers.hashMessage(message);
        const msgHashBytes = ethers.getBytes(msgHash);
        const signature = await walletSignFn(message)
        const recoveredPubKey = SigningKey.recoverPublicKey(msgHashBytes, signature);
        // Remove '0x' prefix and convert to Buffer
        return Buffer.from(recoveredPubKey.slice(2), 'hex');
    }

    async fundWallet() {
        console.log('ahem')
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
            this.nord.nordUrl,
            this.getNonce(),
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
            this.nord.nordUrl,
            this.getNonce(),
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
            this.nord.nordUrl,
            this.getNonce(),
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
            this.nord.nordUrl,
            this.getNonce(),
            this.sessionSignFn,
            this.userId,
            this.sessionId,
            marketId,
            orderId,
        );

        return await message.send();
    }
}
