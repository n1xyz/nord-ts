import { create } from "@bufbuild/protobuf";
import { PublicKey, Transaction } from "@solana/web3.js";
import * as proto from "../../gen/nord_pb";
import { decodeHex, signUserPayload } from "../../utils";
import { createAction, sendAction, expectReceiptKind } from "../api/actions";
import { NordError } from "../utils/NordError";
import { Nord } from "./Nord";
import { FeeTierConfig } from "../../gen/nord_pb";

// NOTE: keep in sync with `acl.rs`.
// NOTE: don't forget `number` as int is internally a u32.
export enum AclRole {
  FEE_MANAGER = 1 << 0,
  MARKET_MANAGER = 1 << 1,
  // TODO: unsure about this?
  ADMIN = 1 << 31,
}

/**
 * Parameters required to register a new token via the admin API.
 */
export interface CreateTokenParams {
  tokenDecimals: number;
  weightBps: number;
  viewSymbol: string;
  oracleSymbol: string;
  mintAddr: PublicKey;
}

/**
 * Parameters used when creating a new market.
 */
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

/**
 * Configuration for updating the Wormhole guardian set on the oracle.
 */
export interface PythSetWormholeGuardiansParams {
  guardianSetIndex: number;
  addresses: string[];
}

/**
 * Parameters required to link an oracle symbol to a Pyth price feed.
 */
export interface PythSetSymbolFeedParams {
  oracleSymbol: string;
  priceFeedId: string;
}

/**
 * Identifies a market that should be frozen.
 */
export interface FreezeMarketParams {
  marketId: number;
}

/**
 * Identifies a market that should be unfrozen.
 */
export interface UnfreezeMarketParams {
  marketId: number;
}

/**
 * Parameters for adding a new fee tier.
 */
export interface AddFeeTierParams {
  config: FeeTierConfig;
}

/**
 * Parameters for updating an existing fee tier.
 */
export interface UpdateFeeTierParams {
  tierId: number;
  config: FeeTierConfig;
}

/**
 * Administrative client capable of submitting privileged configuration actions.
 */
export class NordAdmin {
  private readonly nord: Nord;
  private readonly admin: PublicKey;
  private readonly signFn: (_: Transaction) => Promise<Transaction>;

  private constructor({
    nord,
    admin,
    signFn,
  }: {
    nord: Nord;
    admin: PublicKey;
    signFn: (x: Transaction) => Promise<Transaction>;
  }) {
    this.nord = nord;
    this.admin = admin;
    this.signFn = signFn;
  }

  /** Create a new admin client.
   *
   * @param nord - Nord instance
   * @param admin - The user that will be signing actions.
   * @param signFn - Function to sign messages with the admin's wallet.
   */
  public static new({
    nord,
    admin,
    signFn,
  }: Readonly<{
    nord: Nord;
    admin: PublicKey;
    signFn: (m: Transaction) => Promise<Transaction>;
  }>): NordAdmin {
    return new NordAdmin({
      nord,
      admin,
      signFn,
    });
  }

  /**
   * Submit an action and append the admin signature before sending it to Nord.
   *
   * @param kind - Action payload describing the admin request
   * @throws {NordError} If signing or submission fails
   */
  private async submitAction(
    kind: proto.Action["kind"],
  ): Promise<proto.Receipt> {
    const timestamp = await this.nord.getTimestamp();
    const action = createAction(timestamp, 0, kind);
    return sendAction(
      this.nord.webServerUrl,
      async (xs: Uint8Array) => {
        const signature = await signUserPayload({
          payload: xs,
          user: this.admin,
          signTransaction: this.signFn,
        });
        return Uint8Array.from([...xs, ...signature]);
      },
      action,
    );
  }

  /** Set acl permissions for a given user.
   *
   * If all roles are removed, the user is removed from the acl.
   *
   * @param target - User to update.
   * @param addRoles - Roles to add to the user.
   * @param removeRoles - Reles to remove from the user.
   */
  async updateAcl({
    target,
    addRoles,
    removeRoles,
  }: Readonly<{
    target: PublicKey;
    addRoles: AclRole[];
    removeRoles: AclRole[];
  }>): Promise<{ actionId: bigint } & proto.Receipt_AclUpdated> {
    const allRoles = addRoles.concat(removeRoles);
    if (allRoles.length !== new Set(allRoles).size) {
      throw new NordError("duplicate roles in acl update; must be unique");
    }

    let mask = 0;
    let values = 0;
    for (const role of allRoles) {
      mask |= role;
    }
    for (const role of addRoles) {
      values |= role;
    }

    const receipt = await this.submitAction({
      case: "updateAcl",
      value: create(proto.Action_UpdateAclSchema, {
        aclPubkey: this.admin.toBytes(),
        targetPubkey: target.toBytes(),
        rolesValue: values,
        rolesMask: mask,
      }),
    });
    expectReceiptKind(receipt, "aclUpdated", "update acl");

    return { ...receipt.kind.value, actionId: receipt.actionId };
  }

  /**
   * Register a new token that can be listed on Nord.
   *
   * @param params - Token configuration values
   * @returns Action identifier and resulting token metadata
   * @throws {NordError} If the action submission fails
   */
  async createToken({
    tokenDecimals,
    weightBps,
    viewSymbol,
    oracleSymbol,
    mintAddr,
  }: CreateTokenParams): Promise<
    { actionId: bigint } & proto.Receipt_InsertTokenResult
  > {
    const receipt = await this.submitAction({
      case: "createToken",
      value: create(proto.Action_CreateTokenSchema, {
        aclPubkey: this.admin.toBytes(),
        tokenDecimals,
        weightBps,
        viewSymbol,
        oracleSymbol,
        solAddr: mintAddr.toBytes(),
      }),
    });
    expectReceiptKind(receipt, "insertTokenResult", "create token");
    return { actionId: receipt.actionId, ...receipt.kind.value };
  }

  /**
   * Open a new market with the provided trading parameters.
   *
   * @param params - Market configuration to apply
   * @returns Action identifier and resulting market metadata
   * @throws {NordError} If the action submission fails
   */
  async createMarket(
    params: CreateMarketParams,
  ): Promise<{ actionId: bigint } & proto.Receipt_InsertMarketResult> {
    const receipt = await this.submitAction({
      case: "createMarket",
      value: create(proto.Action_CreateMarketSchema, {
        aclPubkey: this.admin.toBytes(),
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
    expectReceiptKind(receipt, "insertMarketResult", "create market");
    return { actionId: receipt.actionId, ...receipt.kind.value };
  }

  /**
   * Update the Pyth guardian set used for verifying Wormhole messages.
   *
   * Each address must decode from a 20-byte hex string (with or without a
   * leading `0x` prefix). The engine validates the supplied guardian set index
   * before applying the update.
   *
   * @param params - Guardian set index and guardian addresses
   * @returns Action identifier and guardian update receipt
   * @throws {NordError} If the action submission fails
   */
  async pythSetWormholeGuardians(
    params: PythSetWormholeGuardiansParams,
  ): Promise<{ actionId: bigint } & proto.Receipt_UpdateGuardianSetResult> {
    const addresses = params.addresses.map((address) => {
      try {
        const decoded = decodeHex(address);
        if (decoded.length !== 20) {
          throw new Error("guardian address must be 20 bytes");
        }
        return decoded;
      } catch (e) {
        throw new NordError(
          "invalid guardian address; must be a 20 byte hex address",
          { cause: e },
        );
      }
    });

    const receipt = await this.submitAction({
      case: "pythSetWormholeGuardians",
      value: create(proto.Action_PythSetWormholeGuardiansSchema, {
        aclPubkey: this.admin.toBytes(),
        guardianSetIndex: params.guardianSetIndex,
        addresses,
      }),
    });
    expectReceiptKind(
      receipt,
      "updateGuardianSetResult",
      "update wormhole guardians",
    );
    return { actionId: receipt.actionId, ...receipt.kind.value };
  }

  /**
   * Link an oracle symbol to a specific Pyth price feed.
   *
   * The price feed identifier must decode to 32 bytes (with or without a
   * leading `0x` prefix). Use this call to create or update the mapping used
   * by the oracle integration.
   *
   * @param params - Oracle symbol and price feed identifier
   * @returns Action identifier and symbol feed receipt
   * @throws {NordError} If the action submission fails
   */
  async pythSetSymbolFeed(
    params: PythSetSymbolFeedParams,
  ): Promise<{ actionId: bigint } & proto.Receipt_OracleSymbolFeedResult> {
    let priceFeedId: Uint8Array;
    try {
      priceFeedId = decodeHex(params.priceFeedId);
      if (priceFeedId.length !== 32) {
        throw new Error("price feed id must be 32 bytes");
      }
    } catch (e) {
      throw new NordError("invalid price feed id; must be a 32 byte hex id", {
        cause: e,
      });
    }

    const receipt = await this.submitAction({
      case: "pythSetSymbolFeed",
      value: create(proto.Action_PythSetSymbolFeedSchema, {
        aclPubkey: this.admin.toBytes(),
        oracleSymbol: params.oracleSymbol,
        priceFeedId,
      }),
    });
    expectReceiptKind(receipt, "oracleSymbolFeedResult", "set symbol feed");
    return { actionId: receipt.actionId, ...receipt.kind.value };
  }

  /**
   * Pause all trading activity on the exchange.
   *
   * @returns Action identifier confirming the pause
   * @throws {NordError} If the action submission fails
   */
  async pause(): Promise<{ actionId: bigint }> {
    const receipt = await this.submitAction({
      case: "pause",
      value: create(proto.Action_PauseSchema, {
        aclPubkey: this.admin.toBytes(),
      }),
    });
    expectReceiptKind(receipt, "paused", "pause");
    return { actionId: receipt.actionId };
  }

  /**
   * Resume trading activity after a pause.
   *
   * @returns Action identifier confirming the unpause
   * @throws {NordError} If the action submission fails
   */
  async unpause(): Promise<{ actionId: bigint }> {
    const receipt = await this.submitAction({
      case: "unpause",
      value: create(proto.Action_UnpauseSchema, {
        aclPubkey: this.admin.toBytes(),
      }),
    });
    expectReceiptKind(receipt, "unpaused", "unpause");
    return { actionId: receipt.actionId };
  }

  /**
   * Freeze an individual market, preventing new trades and orders.
   *
   * @param params - Target market identifier
   * @returns Action identifier and freeze receipt
   * @throws {NordError} If the action submission fails
   */
  async freezeMarket(
    params: FreezeMarketParams,
  ): Promise<{ actionId: bigint } & proto.Receipt_MarketFreezeUpdated> {
    const receipt = await this.submitAction({
      case: "freezeMarket",
      value: create(proto.Action_FreezeMarketSchema, {
        marketId: params.marketId,
        aclPubkey: this.admin.toBytes(),
      }),
    });
    expectReceiptKind(receipt, "marketFreezeUpdated", "freeze market");
    return { actionId: receipt.actionId, ...receipt.kind.value };
  }

  /**
   * Unfreeze a market that was previously halted.
   *
   * @param params - Target market identifier
   * @returns Action identifier and freeze receipt
   * @throws {NordError} If the action submission fails
   */
  async unfreezeMarket(
    params: UnfreezeMarketParams,
  ): Promise<{ actionId: bigint } & proto.Receipt_MarketFreezeUpdated> {
    const receipt = await this.submitAction({
      case: "unfreezeMarket",
      value: create(proto.Action_UnfreezeMarketSchema, {
        marketId: params.marketId,
        aclPubkey: this.admin.toBytes(),
      }),
    });
    expectReceiptKind(receipt, "marketFreezeUpdated", "unfreeze market");
    return { actionId: receipt.actionId, ...receipt.kind.value };
  }

  /**
   * Append a new fee tier to the account bracket configuration.
   *
   * - The engine supports at most 16 tiers (ids 0–15). Tier 0 is reserved for
   *   the default Nord fees; use `updateFeeTier` if you need to change it.
   * - The first appended tier receives id 1, and subsequent tiers increment the id.
   *
   * @param params - Fee tier configuration to insert
   * @returns Action identifier and fee tier addition receipt
   * @throws {NordError} If the action submission fails or the new tier exceeds the maximum range (0-15).
   */
  async addFeeTier(
    params: AddFeeTierParams,
  ): Promise<{ actionId: bigint } & proto.Receipt_FeeTierAdded> {
    const receipt = await this.submitAction({
      case: "addFeeTier",
      value: create(proto.Action_AddFeeTierSchema, {
        aclPubkey: this.admin.toBytes(),
        config: create(proto.FeeTierConfigSchema, params.config),
      }),
    });
    expectReceiptKind(receipt, "feeTierAdded", "add fee tier");
    return { actionId: receipt.actionId, ...receipt.kind.value };
  }

  /**
   * Update an existing fee tier with new maker/taker rates.
   *
   * Tier identifiers must already exist; attempting to update a missing tier
   * causes the action to fail.
   *
   * @param params - Fee tier identifier and updated configuration
   * @returns Action identifier and fee tier update receipt
   * @throws {NordError} If the action submission fails or the tier ID exceeds the configured range.
   */
  async updateFeeTier(
    params: UpdateFeeTierParams,
  ): Promise<{ actionId: bigint } & proto.Receipt_FeeTierUpdated> {
    const receipt = await this.submitAction({
      case: "updateFeeTier",
      value: create(proto.Action_UpdateFeeTierSchema, {
        aclPubkey: this.admin.toBytes(),
        id: params.tierId,
        config: create(proto.FeeTierConfigSchema, params.config),
      }),
    });
    expectReceiptKind(receipt, "feeTierUpdated", "update fee tier");
    return { actionId: receipt.actionId, ...receipt.kind.value };
  }

  /**
   * Assign a fee tier to one or more accounts.
   *
   * The tier id must be within the configured range (0–15). Every account starts
   * on tier 0; assigning it to another tier requires that tier to exist already.
   * Invalid account ids or tier ids cause the action to fail.
   *
   * @param accounts - Account IDs to update
   * @param tierId - Target fee tier identifier
   * @returns Action identifier and accounts-tier receipt
   * @throws {NordError} If the tier id exceeds the configured range or an account id is invalid.
   */
  async updateAccountsTier(
    accounts: number[],
    tierId: number,
  ): Promise<{ actionId: bigint } & proto.Receipt_AccountsTierUpdated> {
    const receipt = await this.submitAction({
      case: "updateAccountsTier",
      value: create(proto.Action_UpdateAccountsTierSchema, {
        aclPubkey: this.admin.toBytes(),
        accounts,
        tierId,
      }),
    });
    expectReceiptKind(receipt, "accountsTierUpdated", "update accounts tier");
    return { actionId: receipt.actionId, ...receipt.kind.value };
  }
}
