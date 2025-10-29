import * as proto from "../../gen/nord_pb";
import { create } from "@bufbuild/protobuf";
import { checkPubKeyLength } from "../../utils";
import { KeyType } from "../../types";
import { NordError } from "../utils/NordError";
import { NordClient } from "./NordClient";
import type { NordClientParams } from "./NordClient";
import type { NordUser } from "./NordUser";

export interface CreateTokenParams {
  tokenDecimals: number;
  weightBps: number;
  viewSymbol: string;
  oracleSymbol: string;
  solAddr: Uint8Array;
}

export interface CreateMarketParams {
  sizeDecimals: number;
  priceDecimals: number;
  imfBps: number;
  cmfBps: number;
  mmfBps: number;
  marketType: proto.MarketType;
  viewSymbol: string;
  oracleSymbol: string;
  baseTokenId: number;
}

export interface PythSetWormholeGuardiansParams {
  guardianSetIndex: number;
  addresses: Uint8Array[];
}

export interface PythSetSymbolFeedParams {
  oracleSymbol: string;
  priceFeedId: Uint8Array;
}

export interface FreezeMarketParams {
  marketId: number;
}

export interface UnfreezeMarketParams {
  marketId: number;
}

export interface NordAdminParams extends NordClientParams {
  signFn: (message: Uint8Array) => Promise<Uint8Array>;
}

export class NordAdmin extends NordClient {
  private readonly signFn: (message: Uint8Array) => Promise<Uint8Array>;

  constructor(params: NordAdminParams) {
    const { signFn: adminSignFn, ...clientParams } = params;
    super(clientParams);
    this.signFn = adminSignFn;
  }

  clone(): NordAdmin {
    const copy = new NordAdmin({
      nord: this.nord,
      address: this.address,
      walletSignFn: this.walletSignFn,
      sessionSignFn: this.sessionSignFn,
      transactionSignFn: this.transactionSignFn,
      connection: this.connection,
      sessionId: this.sessionId,
      sessionPubKey: new Uint8Array(this.sessionPubKey),
      publicKey: this.publicKey,
      signFn: this.signFn,
    });
    this.cloneClientState(copy);
    return copy;
  }

  static fromUser(
    user: NordUser,
    adminSignFn: (message: Uint8Array) => Promise<Uint8Array>,
  ): NordAdmin {
    return new NordAdmin({
      nord: user.nord,
      address: user.address,
      walletSignFn: user.walletSignFn,
      sessionSignFn: user.sessionSignFn,
      transactionSignFn: user.transactionSignFn,
      connection: user.connection,
      sessionId: user.sessionId,
      sessionPubKey: new Uint8Array(user.sessionPubKey),
      publicKey: user.publicKey,
      signFn: adminSignFn,
    });
  }

  private async submitAction(
    kind: proto.Action["kind"],
  ): Promise<proto.Receipt> {
    try {
      return await this.submitSignedAction(kind, async (message) => {
        const signature = await this.signFn(message);
        const signed = new Uint8Array(message.length + signature.length);
        signed.set(message);
        signed.set(signature, message.length);
        return signed;
      });
    } catch (error) {
      throw new NordError(`Admin action ${kind.case} failed`, {
        cause: error,
      });
    }
  }

  async createToken(
    params: CreateTokenParams,
  ): Promise<{ actionId: bigint } & proto.Receipt_InsertTokenResult> {
    checkPubKeyLength(KeyType.Ed25519, params.solAddr.length);
    const receipt = await this.submitAction({
      case: "createToken",
      value: create(proto.Action_CreateTokenSchema, {
        tokenDecimals: params.tokenDecimals,
        weightBps: params.weightBps,
        viewSymbol: params.viewSymbol,
        oracleSymbol: params.oracleSymbol,
        solAddr: params.solAddr,
      }),
    });
    this.expectReceiptKind(receipt, "insertTokenResult", "create token");
    return { actionId: receipt.actionId, ...receipt.kind.value };
  }

  async createMarket(
    params: CreateMarketParams,
  ): Promise<{ actionId: bigint } & proto.Receipt_InsertMarketResult> {
    const receipt = await this.submitAction({
      case: "createMarket",
      value: create(proto.Action_CreateMarketSchema, {
        sizeDecimals: params.sizeDecimals,
        priceDecimals: params.priceDecimals,
        imfBps: params.imfBps,
        cmfBps: params.cmfBps,
        mmfBps: params.mmfBps,
        marketType: params.marketType,
        viewSymbol: params.viewSymbol,
        oracleSymbol: params.oracleSymbol,
        baseTokenId: params.baseTokenId,
      }),
    });
    this.expectReceiptKind(receipt, "insertMarketResult", "create market");
    return { actionId: receipt.actionId, ...receipt.kind.value };
  }

  async pythSetWormholeGuardians(
    params: PythSetWormholeGuardiansParams,
  ): Promise<{ actionId: bigint } & proto.Receipt_UpdateGuardianSetResult> {
    const receipt = await this.submitAction({
      case: "pythSetWormholeGuardians",
      value: create(proto.Action_PythSetWormholeGuardiansSchema, {
        guardianSetIndex: params.guardianSetIndex,
        addresses: params.addresses,
      }),
    });
    this.expectReceiptKind(
      receipt,
      "updateGuardianSetResult",
      "update wormhole guardians",
    );
    return { actionId: receipt.actionId, ...receipt.kind.value };
  }

  async pythSetSymbolFeed(
    params: PythSetSymbolFeedParams,
  ): Promise<{ actionId: bigint } & proto.Receipt_OracleSymbolFeedResult> {
    const receipt = await this.submitAction({
      case: "pythSetSymbolFeed",
      value: create(proto.Action_PythSetSymbolFeedSchema, {
        oracleSymbol: params.oracleSymbol,
        priceFeedId: params.priceFeedId,
      }),
    });
    this.expectReceiptKind(
      receipt,
      "oracleSymbolFeedResult",
      "set symbol feed",
    );
    return { actionId: receipt.actionId, ...receipt.kind.value };
  }

  async pause(): Promise<{ actionId: bigint }> {
    const receipt = await this.submitAction({
      case: "pause",
      value: create(proto.Action_PauseSchema, {}),
    });
    this.expectReceiptKind(receipt, "paused", "pause");
    return { actionId: receipt.actionId };
  }

  async unpause(): Promise<{ actionId: bigint }> {
    const receipt = await this.submitAction({
      case: "unpause",
      value: create(proto.Action_UnpauseSchema, {}),
    });
    this.expectReceiptKind(receipt, "unpaused", "unpause");
    return { actionId: receipt.actionId };
  }

  async freezeMarket(
    params: FreezeMarketParams,
  ): Promise<{ actionId: bigint } & proto.Receipt_MarketFreezeUpdated> {
    const receipt = await this.submitAction({
      case: "freezeMarket",
      value: create(proto.Action_FreezeMarketSchema, {
        marketId: params.marketId,
      }),
    });
    this.expectReceiptKind(receipt, "marketFreezeUpdated", "freeze market");
    return { actionId: receipt.actionId, ...receipt.kind.value };
  }

  async unfreezeMarket(
    params: UnfreezeMarketParams,
  ): Promise<{ actionId: bigint } & proto.Receipt_MarketFreezeUpdated> {
    const receipt = await this.submitAction({
      case: "unfreezeMarket",
      value: create(proto.Action_UnfreezeMarketSchema, {
        marketId: params.marketId,
      }),
    });
    this.expectReceiptKind(receipt, "marketFreezeUpdated", "unfreeze market");
    return { actionId: receipt.actionId, ...receipt.kind.value };
  }
}
