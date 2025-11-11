import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, Transaction, SendOptions } from "@solana/web3.js";
import Decimal from "decimal.js";
import * as ed from "@noble/ed25519";
import { floatToScaledBigIntLossy } from "@n1xyz/proton";
import {
  FillMode,
  Side,
  SPLTokenInfo,
  QuoteSize,
  TriggerKind,
  fillModeToProtoFillMode,
} from "../types";
import * as proto from "../gen/nord_pb";
import {
  BigIntValue,
  checkedFetch,
  assert,
  findMarket,
  findToken,
  optExpect,
  keypairFromPrivateKey,
  toScaledU64,
} from "../utils";
import { create } from "@bufbuild/protobuf";
import {
  createSession,
  revokeSession,
  atomic,
  expectReceiptKind,
  createAction,
  sendAction,
  AtomicSubaction,
} from "../actions";
import { NordError } from "../error";
import { Nord } from "./Nord";

/**
 * Parameters for individual atomic subactions (user-friendly version)
 */
export interface UserAtomicSubaction {
  /** The type of action to perform. */
  kind: "place" | "cancel";

  /** The market ID to place the order in. */
  marketId?: number;

  /** The order ID to cancel. */
  orderId?: BigIntValue;

  /** Order side (bid or ask) */
  side?: Side;

  /** Fill mode (limit, market, etc.) */
  fillMode?: FillMode;

  /** Whether the order is reduce-only. */
  isReduceOnly?: boolean;

  /** The size of the order. */
  size?: Decimal.Value;

  /** Order price */
  price?: Decimal.Value;

  /** Quote size object (for market-style placement) */
  quoteSize?: QuoteSize;

  /** The client order ID of the order. */
  clientOrderId?: BigIntValue;
}

/**
 * User class for interacting with the Nord protocol
 */
export class NordUser {
  public readonly nord: Nord;
  public readonly sessionSignFn: (message: Uint8Array) => Promise<Uint8Array>;
  public readonly transactionSignFn: (tx: Transaction) => Promise<Transaction>;
  public sessionId?: bigint;
  public sessionPubKey: PublicKey;
  public publicKey: PublicKey;
  public lastTs = 0;

  private nonce = 0;

  /** User balances by token symbol */
  public balances: {
    [key: string]: { accountId: number; balance: number; symbol: string }[];
  } = {};

  /** User positions by account ID */
  public positions: {
    [key: string]: {
      marketId: number;
      openOrders: number;
      perp?: {
        baseSize: number;
        price: number;
        updatedFundingRateIndex: number;
        fundingPaymentPnl: number;
        sizePricePnl: number;
        isLong: boolean;
      };
      actionId: number;
    }[];
  } = {};

  /** User margins by account ID */
  public margins: {
    [key: string]: {
      omf: number;
      mf: number;
      imf: number;
      cmf: number;
      mmf: number;
      pon: number;
      pn: number;
      bankruptcy: boolean;
    };
  } = {};

  /** User's account IDs */
  public accountIds?: number[];

  /** SPL token information */
  public splTokenInfos: SPLTokenInfo[] = [];

  /**
   * Create a new NordUser instance
   *
   * @param nord - Nord client instance
   * @param sessionSignFn - Function to sign messages with the user's session key
   * @param transactionSignFn - Function to sign transactions with the user's wallet (optional)
   * @param sessionId - Existing session identifier
   * @param sessionPubKey - Session public key
   * @param publicKey - Wallet public key
   * @throws {NordError} If required parameters are missing
   */
  constructor({
    nord,
    sessionSignFn,
    transactionSignFn,
    sessionId,
    sessionPubKey,
    publicKey,
  }: Readonly<{
    nord: Nord;
    sessionSignFn: (message: Uint8Array) => Promise<Uint8Array>;
    transactionSignFn: (tx: Transaction) => Promise<Transaction>;
    sessionId?: bigint;
    sessionPubKey: Uint8Array;
    publicKey: PublicKey;
  }>) {
    this.nord = nord;
    this.sessionSignFn = sessionSignFn;
    this.transactionSignFn = transactionSignFn;
    this.sessionId = sessionId;
    this.sessionPubKey = new PublicKey(sessionPubKey);
    this.publicKey = publicKey;

    // Convert tokens from info endpoint to SPLTokenInfo
    if (this.nord.tokens && this.nord.tokens.length > 0) {
      this.splTokenInfos = this.nord.tokens.map((token) => ({
        mint: token.mintAddr, // Use mintAddr as mint
        precision: token.decimals,
        tokenId: token.tokenId,
        name: token.symbol,
      }));
    }
  }

  /**
   * Create a NordUser from a private key
   *
   * @param nord - Nord instance
   * @param privateKey - Private key as string or Uint8Array
   * @returns NordUser instance
   * @throws {NordError} If the private key is invalid
   */
  static fromPrivateKey(nord: Nord, privateKey: string | Uint8Array): NordUser {
    try {
      const keypair = keypairFromPrivateKey(privateKey);
      const publicKey = keypair.publicKey;

      const sessionSignFn = async (
        message: Uint8Array,
      ): Promise<Uint8Array> => {
        // Use ed25519 to sign the message
        return ed.sign(message, keypair.secretKey.slice(0, 32));
      };

      const transactionSignFn = async (
        tx: Transaction,
      ): Promise<Transaction> => {
        tx.sign(keypair);
        return tx;
      };

      return new NordUser({
        nord,
        sessionSignFn,
        transactionSignFn,
        publicKey,
        sessionPubKey: publicKey.toBytes(),
      });
    } catch (error) {
      throw new NordError("Failed to create NordUser from private key", {
        cause: error,
      });
    }
  }

  /**
   * Get the associated token account for a token mint
   *
   * @param mint - Token mint address
   * @returns Associated token account address
   * @throws {NordError} If required parameters are missing or operation fails
   */
  async getAssociatedTokenAccount(mint: PublicKey): Promise<PublicKey> {
    try {
      // Get the token program ID from the mint account
      const mintAccount = await this.nord.solanaConnection.getAccountInfo(mint);
      if (!mintAccount) {
        throw new NordError("Mint account not found");
      }
      const tokenProgramId = mintAccount.owner;

      // Validate that the mint is owned by a supported SPL token program
      if (
        !tokenProgramId.equals(TOKEN_PROGRAM_ID) &&
        !tokenProgramId.equals(TOKEN_2022_PROGRAM_ID)
      ) {
        throw new NordError(
          "Mint Account is not owned by a supported SPL token program",
        );
      }

      const associatedTokenAddress = await getAssociatedTokenAddress(
        mint,
        this.publicKey,
        false,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      return associatedTokenAddress;
    } catch (error) {
      throw new NordError("Failed to get associated token account", {
        cause: error,
      });
    }
  }

  /**
   * Deposit SPL tokens to the app
   *
   * @param amount - Amount to deposit
   * @param tokenId - Token ID
   * @param recipient - Recipient address; defaults to the user's address
   * @returns Transaction signature
   * @deprecated Use deposit instead
   * @throws {NordError} If required parameters are missing or operation fails
   */
  async depositSpl(
    amount: number,
    tokenId: number,
    recipient?: PublicKey,
  ): Promise<string> {
    return this.deposit({ amount, tokenId, recipient });
  }

  /**
   * Deposit SPL tokens to the app
   *
   * @param amount - Amount to deposit
   * @param tokenId - Token ID
   * @param recipient - Recipient address; defaults to the user's address
   * @param sendOptions - Send options for .sendTransaction
   * @returns Transaction signature
   * @throws {NordError} If required parameters are missing or operation fails
   */
  async deposit({
    amount,
    tokenId,
    recipient,
    sendOptions,
  }: Readonly<{
    amount: number;
    tokenId: number;
    recipient?: PublicKey;
    sendOptions?: SendOptions;
  }>): Promise<string> {
    try {
      // Find the token info
      const tokenInfo = this.splTokenInfos.find((t) => t.tokenId === tokenId);
      if (!tokenInfo) {
        throw new NordError(`Token with ID ${tokenId} not found`);
      }

      const mint = new PublicKey(tokenInfo.mint);
      const fromAccount = await this.getAssociatedTokenAccount(mint);
      const payer = this.publicKey;

      const { ix, extraSigner } = await this.nord.protonClient.buildDepositIx({
        payer,
        recipient: recipient ?? payer,
        quantAmount: floatToScaledBigIntLossy(amount, tokenInfo.precision),
        mint,
        sourceTokenAccount: fromAccount,
      });

      const { blockhash } =
        await this.nord.solanaConnection.getLatestBlockhash();
      const tx = new Transaction();

      tx.add(ix);
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer;

      const signedTx = await this.transactionSignFn(tx);
      signedTx.partialSign(extraSigner);

      const signature = await this.nord.solanaConnection.sendRawTransaction(
        signedTx.serialize(),
        sendOptions,
      );

      return signature;
    } catch (error) {
      throw new NordError(
        `Failed to deposit ${amount} of token ID ${tokenId}`,
        { cause: error },
      );
    }
  }

  /**
   * Get a new nonce for actions
   *
   * @returns Nonce as number
   */
  getNonce(): number {
    return ++this.nonce;
  }

  private async submitSessionAction(
    kind: proto.Action["kind"],
  ): Promise<proto.Receipt> {
    return this.submitSignedAction(kind, async (message) => {
      const signature = await this.sessionSignFn(message);
      const signed = new Uint8Array(message.length + signature.length);
      signed.set(message);
      signed.set(signature, message.length);
      return signed;
    });
  }

  /**
   * Update account IDs for this user
   *
   * @throws {NordError} If the operation fails
   */
  async updateAccountId(): Promise<void> {
    try {
      if (!this.publicKey) {
        throw new NordError("Public key is required to update account ID");
      }

      const resp = await this.nord.getUser({
        pubkey: this.publicKey.toBase58(),
      });

      if (!resp) {
        throw new NordError(`User ${this.publicKey.toBase58()} not found`);
      }

      this.accountIds = resp.accountIds;
    } catch (error) {
      throw new NordError("Failed to update account ID", { cause: error });
    }
  }

  /**
   * Fetch user information including balances and orders
   *
   * @throws {NordError} If the operation fails
   */
  async fetchInfo(): Promise<void> {
    type OpenOrder = {
      orderId: number;
      marketId: number;
      side: "ask" | "bid";
      size: number;
      price: number;
      originalOrderSize: number;
      clientOrderId?: number | null;
    };

    type Balance = {
      tokenId: number;
      token: string;
      amount: number;
    };

    type Position = {
      marketId: number;
      openOrders: number;
      perp?: {
        baseSize: number;
        price: number;
        updatedFundingRateIndex: number;
        fundingPaymentPnl: number;
        sizePricePnl: number;
        isLong: boolean;
      };
      actionId: number;
    };

    type Margins = {
      omf: number;
      mf: number;
      imf: number;
      cmf: number;
      mmf: number;
      pon: number;
      pn: number;
      bankruptcy: boolean;
    };

    type Account = {
      updateId: number;
      orders: OpenOrder[];
      positions: Position[];
      balances: Balance[];
      margins: Margins;
    };

    if (this.accountIds !== undefined) {
      const accountsData: (Account & { accountId: number })[] =
        await Promise.all(
          this.accountIds.map(async (accountId) => {
            const response = await checkedFetch(
              `${this.nord.webServerUrl}/account/${accountId}`,
            );
            const accountData = (await response.json()) as Account;
            // Ensure we have the correct accountId
            return {
              ...accountData,
              accountId,
            };
          }),
        );

      for (const accountData of accountsData) {
        // Process balances
        this.balances[accountData.accountId] = [];
        for (const balance of accountData.balances) {
          this.balances[accountData.accountId]!.push({
            accountId: accountData.accountId,
            balance: balance.amount,
            symbol: balance.token,
          });
        }

        // Process positions
        this.positions[accountData.accountId] = accountData.positions;

        // Process margins
        this.margins[accountData.accountId] = accountData.margins;
      }
    }
  }

  /**
   * Refresh the user's session
   *
   * @throws {NordError} If the operation fails
   */
  async refreshSession(): Promise<void> {
    const result = await createSession(
      this.nord.httpClient,
      this.transactionSignFn,
      await this.nord.getTimestamp(),
      this.getNonce(),
      {
        userPubkey: this.publicKey,
        sessionPubkey: this.sessionPubKey,
      },
    );
    this.sessionId = result.sessionId;
  }
  /**
   * Revoke a session
   *
   * @param sessionId - Session ID to revoke
   * @throws {NordError} If the operation fails
   */
  async revokeSession(sessionId: BigIntValue): Promise<void> {
    try {
      await revokeSession(
        this.nord.httpClient,
        this.transactionSignFn,
        await this.nord.getTimestamp(),
        this.getNonce(),
        {
          userPubkey: this.publicKey,
          sessionId,
        },
      );
    } catch (error) {
      throw new NordError(`Failed to revoke session ${sessionId}`, {
        cause: error,
      });
    }
  }

  /**
   * Checks if the session is valid
   * @private
   * @throws {NordError} If the session is not valid
   */
  private checkSessionValidity(): void {
    if (this.sessionId === undefined || this.sessionId === BigInt(0)) {
      throw new NordError(
        "Invalid or empty session ID. Please create or refresh your session.",
      );
    }
  }

  /**
   * Withdraw tokens from the exchange
   *
   * @param tokenId - Token ID to withdraw
   * @param amount - Amount to withdraw
   * @throws {NordError} If the operation fails
   */
  async withdraw({
    amount,
    tokenId,
  }: Readonly<{
    tokenId: number;
    amount: number;
  }>): Promise<{ actionId: bigint }> {
    try {
      this.checkSessionValidity();
      const token = findToken(this.nord.tokens, tokenId);
      const scaledAmount = toScaledU64(amount, token.decimals);
      if (scaledAmount <= 0n) {
        throw new NordError("Withdraw amount must be positive");
      }
      const receipt = await this.submitSessionAction({
        case: "withdraw",
        value: create(proto.Action_WithdrawSchema, {
          sessionId: BigInt(optExpect(this.sessionId, "No session")),
          tokenId,
          amount: scaledAmount,
        }),
      });
      expectReceiptKind(receipt, "withdrawResult", "withdraw");
      return { actionId: receipt.actionId };
    } catch (error) {
      throw new NordError(
        `Failed to withdraw ${amount} of token ID ${tokenId}`,
        { cause: error },
      );
    }
  }

  /**
   * Place an order on the exchange
   *
   * @param marketId - Target market identifier
   * @param side - Order side
   * @param fillMode - Fill mode (limit, market, etc.)
   * @param isReduceOnly - Reduce-only flag
   * @param size - Base size to place
   * @param price - Limit price
   * @param quoteSize - Quote-sized order representation
   * @param accountId - Account executing the order
   * @param clientOrderId - Optional client-specified identifier
   * @returns Object containing actionId, orderId (if posted), fills, and clientOrderId
   * @throws {NordError} If the operation fails
   */
  async placeOrder({
    marketId,
    side,
    fillMode,
    isReduceOnly,
    size,
    price,
    quoteSize,
    accountId,
    clientOrderId,
  }: Readonly<{
    marketId: number;
    side: Side;
    fillMode: FillMode;
    isReduceOnly: boolean;
    size?: Decimal.Value;
    price?: Decimal.Value;
    quoteSize?: QuoteSize;
    accountId?: number;
    clientOrderId?: BigIntValue;
  }>): Promise<{
    actionId: bigint;
    orderId?: bigint;
    fills: proto.Receipt_Trade[];
  }> {
    try {
      this.checkSessionValidity();
      const market = findMarket(this.nord.markets, marketId);
      if (!market) {
        throw new NordError(`Market with ID ${marketId} not found`);
      }
      const sessionId = optExpect(this.sessionId, "No session");
      const scaledPrice = toScaledU64(price ?? 0, market.priceDecimals);
      const scaledSize = toScaledU64(size ?? 0, market.sizeDecimals);
      const scaledQuote = quoteSize
        ? quoteSize.toWire(market.priceDecimals, market.sizeDecimals)
        : undefined;
      assert(
        scaledPrice > 0n || scaledSize > 0n || scaledQuote !== undefined,
        "OrderLimit must include at least one of: size, price, or quoteSize",
      );

      const receipt = await this.submitSessionAction({
        case: "placeOrder",
        value: create(proto.Action_PlaceOrderSchema, {
          sessionId: BigInt(sessionId),
          senderAccountId: accountId,
          marketId,
          side: side === Side.Bid ? proto.Side.BID : proto.Side.ASK,
          fillMode: fillModeToProtoFillMode(fillMode),
          isReduceOnly,
          price: scaledPrice,
          size: scaledSize,
          quoteSize:
            scaledQuote === undefined
              ? undefined
              : create(proto.QuoteSizeSchema, {
                  size: scaledQuote.size,
                  price: scaledQuote.price,
                }),
          clientOrderId:
            clientOrderId === undefined ? undefined : BigInt(clientOrderId),
        }),
      });
      expectReceiptKind(receipt, "placeOrderResult", "place order");
      const result = receipt.kind.value;
      return {
        actionId: receipt.actionId,
        orderId: result.posted?.orderId,
        fills: result.fills,
      };
    } catch (error) {
      throw new NordError("Failed to place order", { cause: error });
    }
  }

  /**
   * Cancel an order
   *
   * @param orderId - Order ID to cancel
   * @param providedAccountId - Account ID that placed the order
   * @returns Object containing actionId, cancelled orderId, and accountId
   * @throws {NordError} If the operation fails
   */
  async cancelOrder(
    orderId: BigIntValue,
    providedAccountId?: number,
  ): Promise<{
    actionId: bigint;
    orderId: bigint;
    accountId: number;
  }> {
    const accountId =
      providedAccountId != null ? providedAccountId : this.accountIds?.[0];
    try {
      this.checkSessionValidity();
      const receipt = await this.submitSessionAction({
        case: "cancelOrderById",
        value: create(proto.Action_CancelOrderByIdSchema, {
          orderId: BigInt(orderId),
          sessionId: BigInt(optExpect(this.sessionId, "No session")),
          senderAccountId: accountId,
        }),
      });
      expectReceiptKind(receipt, "cancelOrderResult", "cancel order");
      return {
        actionId: receipt.actionId,
        orderId: receipt.kind.value.orderId,
        accountId: receipt.kind.value.accountId,
      };
    } catch (error) {
      throw new NordError(`Failed to cancel order ${orderId}`, {
        cause: error,
      });
    }
  }

  /**
   * Add a trigger for the current session
   *
   * @param marketId - Market to watch
   * @param side - Order side for the trigger
   * @param kind - Stop-loss or take-profit trigger type
   * @param triggerPrice - Price that activates the trigger
   * @param limitPrice - Limit price placed once the trigger fires
   * @param accountId - Account executing the trigger
   * @returns Object containing the actionId of the submitted trigger
   * @throws {NordError} If the operation fails
   */
  async addTrigger({
    marketId,
    side,
    kind,
    triggerPrice,
    limitPrice,
    accountId,
  }: Readonly<{
    marketId: number;
    side: Side;
    kind: TriggerKind;
    triggerPrice: Decimal.Value;
    limitPrice?: Decimal.Value;
    accountId?: number;
  }>): Promise<{ actionId: bigint }> {
    try {
      this.checkSessionValidity();
      const market = findMarket(this.nord.markets, marketId);
      if (!market) {
        throw new NordError(`Market with ID ${marketId} not found`);
      }
      const scaledTriggerPrice = toScaledU64(
        triggerPrice,
        market.priceDecimals,
      );
      assert(scaledTriggerPrice > 0n, "Trigger price must be positive");
      const scaledLimitPrice =
        limitPrice === undefined
          ? undefined
          : toScaledU64(limitPrice, market.priceDecimals);
      if (scaledLimitPrice !== undefined) {
        assert(scaledLimitPrice > 0n, "Limit price must be positive");
      }
      const key = create(proto.TriggerKeySchema, {
        kind:
          kind === TriggerKind.StopLoss
            ? proto.TriggerKind.STOP_LOSS
            : proto.TriggerKind.TAKE_PROFIT,
        side: side === Side.Bid ? proto.Side.BID : proto.Side.ASK,
      });
      const prices = create(proto.Action_TriggerPricesSchema, {
        triggerPrice: scaledTriggerPrice,
        limitPrice: scaledLimitPrice,
      });
      const receipt = await this.submitSessionAction({
        case: "addTrigger",
        value: create(proto.Action_AddTriggerSchema, {
          sessionId: BigInt(optExpect(this.sessionId, "No session")),
          marketId,
          key,
          prices,
          accountId,
        }),
      });
      expectReceiptKind(receipt, "triggerAdded", "add trigger");
      return { actionId: receipt.actionId };
    } catch (error) {
      throw new NordError("Failed to add trigger", { cause: error });
    }
  }

  /**
   * Remove a trigger for the current session
   *
   * @param marketId - Market the trigger belongs to
   * @param side - Order side for the trigger
   * @param kind - Stop-loss or take-profit trigger type
   * @param accountId - Account executing the trigger
   * @returns Object containing the actionId of the removal action
   * @throws {NordError} If the operation fails
   */
  async removeTrigger({
    marketId,
    side,
    kind,
    accountId,
  }: Readonly<{
    marketId: number;
    side: Side;
    kind: TriggerKind;
    accountId?: number;
  }>): Promise<{ actionId: bigint }> {
    try {
      this.checkSessionValidity();
      const market = findMarket(this.nord.markets, marketId);
      if (!market) {
        throw new NordError(`Market with ID ${marketId} not found`);
      }
      const key = create(proto.TriggerKeySchema, {
        kind:
          kind === TriggerKind.StopLoss
            ? proto.TriggerKind.STOP_LOSS
            : proto.TriggerKind.TAKE_PROFIT,
        side: side === Side.Bid ? proto.Side.BID : proto.Side.ASK,
      });
      const receipt = await this.submitSessionAction({
        case: "removeTrigger",
        value: create(proto.Action_RemoveTriggerSchema, {
          sessionId: BigInt(optExpect(this.sessionId, "No session")),
          marketId,
          key,
          accountId,
        }),
      });
      expectReceiptKind(receipt, "triggerRemoved", "remove trigger");
      return { actionId: receipt.actionId };
    } catch (error) {
      throw new NordError("Failed to remove trigger", { cause: error });
    }
  }

  /**
   * Transfer tokens to another account
   *
   * @param tokenId - Token identifier to move
   * @param amount - Amount to transfer
   * @param fromAccountId - Source account id
   * @param toAccountId - Destination account id
   * @throws {NordError} If the operation fails
   */
  async transferToAccount({
    tokenId,
    amount,
    fromAccountId,
    toAccountId,
  }: Readonly<{
    tokenId: number;
    amount: Decimal.Value;
    fromAccountId?: number;
    toAccountId?: number;
  }>): Promise<{
    actionId: bigint;
    newAccountId?: number;
  }> {
    try {
      this.checkSessionValidity();
      const token = findToken(this.nord.tokens, tokenId);

      const scaledAmount = toScaledU64(amount, token.decimals);
      if (scaledAmount <= 0n) {
        throw new NordError("Transfer amount must be positive");
      }

      const receipt = await this.submitSessionAction({
        case: "transfer",
        value: create(proto.Action_TransferSchema, {
          sessionId: BigInt(optExpect(this.sessionId, "No session")),
          fromAccountId: optExpect(fromAccountId, "No source account"),
          toAccountId: optExpect(toAccountId, "No target account"),
          tokenId,
          amount: scaledAmount,
        }),
      });
      expectReceiptKind(receipt, "transferred", "transfer tokens");
      if (receipt.kind.value.accountCreated) {
        assert(
          receipt.kind.value.toUserAccount !== undefined,
          `toAccount must be defined on new account on ${receipt.kind.value}`,
        );
        return {
          actionId: receipt.actionId,
          newAccountId: receipt.kind.value.toUserAccount,
        };
      } else {
        return { actionId: receipt.actionId };
      }
    } catch (error) {
      throw new NordError("Failed to transfer tokens", { cause: error });
    }
  }

  /**
   * Execute up to four place/cancel operations atomically.
   * Per Market:
   * 1. cancels can only be in the start (one cannot predict future order ids)
   * 2. intermediate trades can trade only
   * 3. placements go last
   *
   * Across Markets, order action can be any
   *
   * @param userActions array of user-friendly subactions
   * @param providedAccountId optional account performing the action (defaults to first account)
   */
  async atomic(
    userActions: UserAtomicSubaction[],
    providedAccountId?: number,
  ): Promise<{
    actionId: bigint;
    results: proto.Receipt_AtomicSubactionResultKind[];
  }> {
    try {
      this.checkSessionValidity();

      const accountId =
        providedAccountId != null ? providedAccountId : this.accountIds?.[0];

      if (accountId == null) {
        throw new NordError(
          "Account ID is undefined. Make sure to call updateAccountId() before atomic operations.",
        );
      }

      const apiActions: AtomicSubaction[] = userActions.map((act) => {
        if (act.kind === "place") {
          const market = findMarket(this.nord.markets, act.marketId!);
          if (!market) {
            throw new NordError(`Market ${act.marketId} not found`);
          }
          return {
            kind: "place",
            marketId: act.marketId,
            side: act.side,
            fillMode: act.fillMode,
            isReduceOnly: act.isReduceOnly,
            sizeDecimals: market.sizeDecimals,
            priceDecimals: market.priceDecimals,
            size: act.size,
            price: act.price,
            quoteSize: act.quoteSize,
            clientOrderId: act.clientOrderId,
          } as AtomicSubaction;
        }
        return {
          kind: "cancel",
          orderId: act.orderId,
        } as AtomicSubaction;
      });

      const result = await atomic(
        this.nord.httpClient,
        this.sessionSignFn,
        await this.nord.getTimestamp(),
        this.getNonce(),
        {
          sessionId: optExpect(this.sessionId, "No session"),
          accountId: accountId,
          actions: apiActions,
        },
      );
      return result;
    } catch (error) {
      throw new NordError("Atomic operation failed", { cause: error });
    }
  }

  /**
   * Helper function to retry a promise with exponential backoff
   *
   * @param fn - Function to retry
   * @param maxRetries - Maximum number of retries
   * @param initialDelay - Initial delay in milliseconds
   * @returns Promise result
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    initialDelay: number = 500,
  ): Promise<T> {
    let retries = 0;
    let delay = initialDelay;

    while (true) {
      try {
        return await fn();
      } catch (error) {
        if (retries >= maxRetries) {
          throw error;
        }

        // Check if error is rate limiting related
        const isRateLimitError =
          error instanceof Error &&
          (error.message.includes("rate limit") ||
            error.message.includes("429") ||
            error.message.includes("too many requests"));

        if (!isRateLimitError) {
          throw error;
        }

        retries++;
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
    }
  }

  /**
   * Get user's token balances on Solana chain using mintAddr
   *
   * @param options - Optional parameters
   * @param options.includeZeroBalances - Whether to include tokens with zero balance (default: true)
   * @param options.includeTokenAccounts - Whether to include token account addresses in the result (default: false)
   * @param options.maxConcurrent - Maximum number of concurrent requests (default: 5)
   * @param options.maxRetries - Maximum number of retries for rate-limited requests (default: 3)
   * @returns Object with token balances and optional token account addresses
   * @throws {NordError} If required parameters are missing or operation fails
   */
  async getSolanaBalances(
    options: {
      includeZeroBalances?: boolean;
      includeTokenAccounts?: boolean;
      maxConcurrent?: number;
      maxRetries?: number;
    } = {},
  ): Promise<{
    balances: { [symbol: string]: number };
    tokenAccounts?: { [symbol: string]: string };
  }> {
    const {
      includeZeroBalances = true,
      includeTokenAccounts = false,
      maxConcurrent = 5,
      maxRetries = 3,
    } = options;

    const balances: { [symbol: string]: number } = {};
    const tokenAccounts: { [symbol: string]: string } = {};

    try {
      // Get SOL balance (native token)
      const solBalance = await this.retryWithBackoff(
        () => this.nord.solanaConnection.getBalance(this.publicKey),
        maxRetries,
      );
      balances["SOL"] = solBalance / 1e9; // Convert lamports to SOL
      if (includeTokenAccounts) {
        tokenAccounts["SOL"] = this.publicKey.toString();
      }

      // Get SPL token balances using mintAddr from Nord tokens
      if (this.nord.tokens && this.nord.tokens.length > 0) {
        const tokens = this.nord.tokens.filter((token) => !!token.mintAddr);

        // Process tokens in batches to avoid rate limiting
        for (let i = 0; i < tokens.length; i += maxConcurrent) {
          const batch = tokens.slice(i, i + maxConcurrent);

          // Process batch in parallel
          const batchPromises = batch.map(async (token) => {
            try {
              const mint = new PublicKey(token.mintAddr);
              const associatedTokenAddress = await this.retryWithBackoff(
                () => getAssociatedTokenAddress(mint, this.publicKey),
                maxRetries,
              );

              if (includeTokenAccounts) {
                tokenAccounts[token.symbol] = associatedTokenAddress.toString();
              }

              try {
                const tokenBalance = await this.retryWithBackoff(
                  () =>
                    this.nord.solanaConnection.getTokenAccountBalance(
                      associatedTokenAddress,
                    ),
                  maxRetries,
                );
                const balance = Number(tokenBalance.value.uiAmount);

                if (balance > 0 || includeZeroBalances) {
                  balances[token.symbol] = balance;
                }
              } catch {
                // Token account might not exist yet, set balance to 0
                if (includeZeroBalances) {
                  balances[token.symbol] = 0;
                }
              }
            } catch (error) {
              console.error(
                `Error getting balance for token ${token.symbol}:`,
                error,
              );
              if (includeZeroBalances) {
                balances[token.symbol] = 0;
              }
            }
          });

          // Wait for current batch to complete before processing next batch
          await Promise.all(batchPromises);
        }
      }

      return includeTokenAccounts ? { balances, tokenAccounts } : { balances };
    } catch (error) {
      throw new NordError("Failed to get Solana token balances", {
        cause: error,
      });
    }
  }

  protected async submitSignedAction(
    kind: proto.Action["kind"],
    makeSignedMessage: (message: Uint8Array) => Promise<Uint8Array>,
  ): Promise<proto.Receipt> {
    const nonce = this.getNonce();
    const currentTimestamp = await this.nord.getTimestamp();
    const action = createAction(currentTimestamp, nonce, kind);
    return sendAction(this.nord.httpClient, makeSignedMessage, action);
  }
}
