import { Connection, PublicKey } from "@solana/web3.js";
import type { Transaction } from "@solana/web3.js";
import * as proto from "../../gen/nord_pb";
import { createAction, sendAction } from "../api/actions";
import { NordError } from "../utils/NordError";
import { Nord } from "./Nord";

type ReceiptKind = NonNullable<proto.Receipt["kind"]>;
type ExtractReceiptKind<K extends ReceiptKind["case"]> = Extract<
  ReceiptKind,
  { case: K }
>;

export interface NordClientParams {
  nord: Nord;
  address: PublicKey;
  walletSignFn: (message: Uint8Array | string) => Promise<Uint8Array>;
  sessionSignFn: (message: Uint8Array) => Promise<Uint8Array>;
  transactionSignFn: <T extends Transaction>(tx: T) => Promise<T>;
  connection?: Connection;
  sessionId?: bigint;
  sessionPubKey: Uint8Array;
  publicKey: PublicKey;
}

export abstract class NordClient {
  public readonly nord: Nord;
  public readonly address: PublicKey;
  public readonly walletSignFn: (
    message: Uint8Array | string,
  ) => Promise<Uint8Array>;
  public readonly sessionSignFn: (message: Uint8Array) => Promise<Uint8Array>;
  public readonly transactionSignFn: <T extends Transaction>(
    tx: T,
  ) => Promise<T>;
  public connection: Connection;
  public sessionId?: bigint;
  public sessionPubKey: Uint8Array;
  public publicKey: PublicKey;
  public lastTs = 0;

  protected actionNonce = 0;

  protected constructor(params: NordClientParams) {
    this.nord = params.nord;
    this.address = params.address;
    this.walletSignFn = params.walletSignFn;
    this.sessionSignFn = params.sessionSignFn;
    this.transactionSignFn = params.transactionSignFn;
    this.connection =
      params.connection ??
      new Connection(params.nord.solanaUrl, {
        commitment: "confirmed",
      });
    this.sessionId = params.sessionId;
    this.sessionPubKey = new Uint8Array(params.sessionPubKey);
    this.publicKey = params.publicKey;
  }

  protected async submitSignedAction(
    kind: proto.Action["kind"],
    makeSignedMessage: (message: Uint8Array) => Promise<Uint8Array>,
  ): Promise<proto.Receipt> {
    const nonce = this.nextActionNonce();
    const currentTimestamp = await this.nord.getTimestamp();
    const action = createAction(currentTimestamp, nonce, kind);
    return sendAction(this.nord.webServerUrl, makeSignedMessage, action);
  }

  protected nextActionNonce(): number {
    return ++this.actionNonce;
  }

  protected cloneClientState(target: NordClient): void {
    target.connection = this.connection;
    target.sessionId = this.sessionId;
    target.sessionPubKey = new Uint8Array(this.sessionPubKey);
    target.publicKey = this.publicKey;
    target.lastTs = this.lastTs;
    target.actionNonce = this.actionNonce;
  }

  getSolanaPublicKey(): PublicKey {
    return this.address;
  }

  protected expectReceiptKind<K extends ReceiptKind["case"]>(
    receipt: proto.Receipt,
    expected: K,
    action: string,
  ): asserts receipt is proto.Receipt & { kind: ExtractReceiptKind<K> } {
    if (receipt.kind?.case !== expected) {
      const label = this.formatReceiptError(receipt);
      throw new NordError(`Failed to ${action}: ${label}`);
    }
  }

  protected formatReceiptError(receipt: proto.Receipt): string {
    if (receipt.kind?.case === "err") {
      const err = receipt.kind.value;
      return proto.Error[err] ?? err.toString();
    }
    return receipt.kind?.case ?? "unknown";
  }
}
