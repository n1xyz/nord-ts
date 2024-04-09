import {ethers} from "ethers";
import {
    CancelOrderParams,
    CreateSessionParams,
    FillMode,
    fillModeToProtoFillMode,
    KeyType,
    PlaceOrderParams,
    Side,
    WithdrawParams,
} from "../types";
import {
    checkPubKeyLength,
    decodeDelimited,
    encodeDelimited,
    getCurrentTimestamp,
    printableError,
    SESSION_TTL,
    toShiftedNumber,
} from "../utils";
import * as proto from "../gen/nord";
import fetch from "node-fetch";

export class Action {
    nordActionUrl: string;

    constructor(nordUrl: string) {
        this.nordActionUrl = `${nordUrl}/action`;
    }

    /**
     * Sends a post request to the defined NORD_URL endpoint.
     * @param payload - The message data to send.
     * @returns Response data in Uint8Array.
     */
    protected async sendMessage(payload: Uint8Array): Promise<Uint8Array> {
        try {
            const response = await fetch(this.nordActionUrl, {
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
}

export class CreateSessionAction extends Action {
    message: Uint8Array;
    walletSignFn: (message: Uint8Array) => Promise<string>;

    constructor(
        url: string,
        nonce: number,
        sessionPubkey: Uint8Array,
        walletSignFn: (message: Uint8Array) => Promise<string>,
        userId: number,
    ) {
        super(url);
        this.walletSignFn = walletSignFn;

        this.message = CreateSessionAction.getPayload({
            userId,
            nonce,
            keyType: KeyType.Ed25119,
            pubkey: sessionPubkey,
            expiryTs: getCurrentTimestamp() + SESSION_TTL,
        });
    }

    async send(): Promise<number> {
        const signature = await this.walletSignFn(this.message);
        const body = new Uint8Array([
            ...this.message,
            ...ethers.getBytes(signature.slice(0, -2)),
        ]);
        const resp = decodeDelimited(await this.sendMessage(body));
        if (resp.has_err) {
            throw new Error(
                `Could not create a new session, reason: ${printableError(resp.err)}`,
            );
        }

        return resp.create_session_result.session_id;
    }

    /**
     * Generates a createSession action payload.
     *
     * @param params - Parameters to create a new session.
     * @param params.userId - ID of the user.
     * @param params.blstPubkey - BLS public key (must be 96 bytes).
     * @param params.expiryTs - Expiry timestamp of the session.
     * @returns Encoded message as Uint8Array.
     * @throws Will throw an error if pubkey length isn't 96 or expiry timestamp is in the past.
     */
    static getPayload(params: CreateSessionParams): Uint8Array {
        checkPubKeyLength(params.keyType, params.pubkey.length);

        if (params.expiryTs <= Math.ceil(Date.now() / 1000)) {
            throw new Error("Cannot set an expiry timestamp in the past.");
        }

        const pbCreateSession = proto.nord.Action.fromObject({
            current_timestamp: getCurrentTimestamp(),
            nonce: params.nonce,
            create_session: new proto.nord.Action.CreateSession({
                user_id: params.userId,
                blst_pubkey: params.pubkey,
                expiry_timestamp: params.expiryTs,
            }),
        });

        return encodeDelimited(pbCreateSession);
    }
}

export class WithdrawAction extends Action {
    message: Uint8Array;
    signFn: (message: Uint8Array) => Promise<Uint8Array>;

    constructor(
        url: string,
        nonce: number,
        signFn: (message: Uint8Array) => Promise<Uint8Array>,
        sizeDecimals: number,
        tokenId: number,
        sessionId: number,
        amount: number,
    ) {
        super(url);
        this.signFn = signFn;

        this.message = WithdrawAction.getPayload({
            tokenId,
            sessionId,
            nonce,
            amount: toShiftedNumber(amount, sizeDecimals),
        });
    }

    async send(): Promise<void> {
        const signature = await this.signFn(this.message);
        const body = new Uint8Array([...this.message, ...signature]);
        const resp = decodeDelimited(await this.sendMessage(body));
        if (resp.has_err) {
            throw new Error(
                `Could not withdraw, reason: ${printableError(resp.err)}`,
            );
        }
        // Receipt for Withdraw does not implemented
    }

    /**
     * Generates a withdraw action payload.
     *
     * @param params - Parameters for withdrawal.
     * @param params.tokenId - ID of the token.
     * @param params.userId - ID of the user.
     * @param params.amount - Amount to withdraw.
     * @returns Encoded message as Uint8Array.
     * @throws Will throw an error if withdrawal amount is 0 or less.
     */
    static getPayload(params: WithdrawParams): Uint8Array {
        if (params.amount < 0) {
            throw new Error("Cannot withdraw 0 or less.");
        }

        const pbWithdraw = proto.nord.Action.fromObject({
            current_timestamp: getCurrentTimestamp(),
            nonce: params.nonce,
            withdraw: new proto.nord.Action.Withdraw({
                token_id: params.tokenId,
                session_id: params.sessionId,
                amount: params.amount,
            }),
        });

        return encodeDelimited(pbWithdraw);
    }
}

export class PlaceOrderAction extends Action {
    message: Uint8Array;
    signFn: (message: Uint8Array) => Promise<Uint8Array>;

    constructor(
        url: string,
        nonce: number,
        signFn: (message: Uint8Array) => Promise<Uint8Array>,
        sizeDecimals: number,
        priceDecimals: number,
        userId: number,
        sessionId: number,
        marketId: number,
        side: Side,
        fillMode: FillMode,
        isReduceOnly: boolean,
        size: number,
        price?: number,
    ) {
        console.log(size,price,toShiftedNumber(price ?? 0, priceDecimals))
        super(url);
        this.signFn = signFn;
        this.message = PlaceOrderAction.getPayload({
            userId,
            nonce,
            marketId,
            side,
            fillMode,
            isReduceOnly,
            price: toShiftedNumber(price ?? 0, priceDecimals),
            size: toShiftedNumber(size, sizeDecimals),
            sessionId,
        });
    }

    async send(): Promise<number | null> {
        const signature = await this.signFn(this.message);
        const body = new Uint8Array([...this.message, ...signature]);
        const resp = decodeDelimited(await this.sendMessage(body));
        if (resp.has_err) {
            throw new Error(
                `Could not place the order, reason: ${printableError(resp.err)}`,
            );
        }

        if (resp.place_order_result.posted) {
            return resp.place_order_result.posted.order_id;
        }
        return null
    }

    /**
     * Generates a placeOrder action payload.
     *
     * @param params - Parameters to place an order.
     * @param params.userId - ID of the user.
     * @param params.marketId - ID of the market.
     * @param params.side - (Ask | Bid)
     * @param params.fillMode - (Limit | PostOnly | ImmediateOrCancel | FillOrKill)
     * @param params.isReduceOnly - If the order is reduce-only.
     * @param params.price - Price of the order (optional) (Decimal).
     * @param params.size - Size of the order (Decimal).
     * @param params.sessionId - ID of the session.
     * @returns Encoded message as Uint8Array.
     * @throws Will throw an error if order price or size is 0.
     */
    static getPayload(params: PlaceOrderParams): Uint8Array {
        if (params.price !== undefined && params.price < 0) {
            throw new Error("Cannot use 0 price for order.");
        }

        if (params.size !== undefined && params.size < 0) {
            throw new Error("Cannot use 0 size for order.");
        }

        const pbPlaceOrder = proto.nord.Action.fromObject({
            current_timestamp: getCurrentTimestamp(),
            nonce: params.nonce,
            place_order: new proto.nord.Action.PlaceOrder({
                market_id: params.marketId,
                side:
                    params.side === Side.Bid ? proto.nord.Side.BID : proto.nord.Side.ASK,
                fill_mode: fillModeToProtoFillMode(params.fillMode),
                is_reduce_only: params.isReduceOnly,
                price: params.price,
                size: params.size,
                session_id: params.sessionId,
            }),
        });

        return encodeDelimited(pbPlaceOrder);
    }
}

export class CancelOrderAction extends Action {
    message: Uint8Array;
    signFn: (message: Uint8Array) => Promise<Uint8Array>;

    constructor(
        url: string,
        nonce: number,
        signFn: (message: Uint8Array) => Promise<Uint8Array>,
        userId: number,
        sessionId: number,
        marketId: number,
        orderId: number,
    ) {
        super(url);
        this.signFn = signFn;

        this.message = CancelOrderAction.getPayload({
            userId,
            nonce,
            sessionId,
            marketId,
            orderId,
        });
    }

    async send(): Promise<number> {
        const signature = await this.signFn(this.message);
        const body = new Uint8Array([...this.message, ...signature]);
        const resp = decodeDelimited(await this.sendMessage(body));
        if (resp.has_err) {
            throw new Error(
                `Could not cancel the order, reason: ${printableError(resp.err)}`,
            );
        }

        return resp.cancel_order_result.order_id;
    }

    /**
     * Generates a cancelOrderById action payload.
     *
     * @param params - Parameters to cancel an order.
     * @param params.marketId - ID of the market.
     * @param params.userId - ID of the user.
     * @param params.orderId - ID of the order to be canceled.
     * @param params.sessionId - ID of the session.
     * @returns Encoded message as Uint8Array.
     */
    static getPayload(params: CancelOrderParams): Uint8Array {
        const pbCancelOrder = proto.nord.Action.fromObject({
            current_timestamp: getCurrentTimestamp(),
            nonce: params.nonce,
            cancel_order_by_id: new proto.nord.Action.CancelOrderById({
                order_id: params.orderId,
                session_id: params.sessionId,
            }),
        });
        return encodeDelimited(pbCancelOrder);
    }
}
