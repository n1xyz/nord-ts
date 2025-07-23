import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import Decimal from "decimal.js";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
ed.etc.sha512Sync = sha512;
import { floatToScaledBigIntLossy } from "@n1xyz/proton";
import { FillMode, Side, SPLTokenInfo } from "../../types";
import * as proto from "../../gen/nord_pb";
import {
  BigIntValue,
  checkedFetch,
  findMarket,
  findToken,
  optExpect,
  keypairFromPrivateKey,
} from "../../utils";
import {
  cancelOrder,
  createSession,
  placeOrder,
  revokeSession,
  transfer,
  withdraw,
  atomic as atomicAction,
  AtomicSubaction as ApiAtomicSubaction,
} from "../api/actions";
import { NordError } from "../utils/NordError";
import { Nord } from "./Nord";

/**
 * Parameters for creating a NordUser instance
 */
export interface NordUserParams {
  /** Nord client instance */
  nord: Nord;

  /** User's blockchain address */
  address: string;

  /** Function to sign messages with the user's wallet */
  walletSignFn: (message: Uint8Array | string) => Promise<Uint8Array>;

  /** Function to sign messages with the user's session key */
  sessionSignFn: (message: Uint8Array) => Promise<Uint8Array>;

  /** Function to sign transactions with the user's wallet (optional) */
  transactionSignFn: <T extends Transaction>(tx: T) => Promise<T>;

  /** Solana connection (optional) */
  connection?: Connection;

  /** Session ID (optional) */
  sessionId?: bigint;

  /** Session public key (required) */
  sessionPubKey: Uint8Array;

  /** Session public key (required) */
  publicKey: PublicKey;
}

/**
 * Parameters for placing an order
 */
export interface PlaceOrderParams {
  /** Market ID */
  marketId: number;

  /** Order side (bid or ask) */
  side: Side;

  /** Fill mode (limit, market, etc.) */
  fillMode: FillMode;

  /** Whether the order is reduce-only */
  isReduceOnly: boolean;

  /** Order size */
  size?: Decimal.Value;

  /** Order price */
  price?: Decimal.Value;

  /** Quote size (for market orders) */
  quoteSize?: Decimal.Value;

  /** Account ID to place the order from */
  accountId?: number;
}

/**
 * Parameters for transferring tokens between accounts
 */
export interface TransferParams {
  /** Recipient user */
  to: NordUser;

  /** Token ID to transfer */
  tokenId: number;

  /** Amount to transfer */
  amount: Decimal.Value;

  /** Source account ID */
  fromAccountId: number;

  /** Destination account ID */
  toAccountId: number;
}

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

  /** Quote size (for market orders) */
  quoteSize?: Decimal.Value;

  /** The client order ID of the order. */
  clientOrderId?: BigIntValue;
}

/**
 * User class for interacting with the Nord protocol
 */
export class NordUser {
  /** Nord client instance */
  public readonly nord: Nord;

  /** User's blockchain address */
  public readonly address: PublicKey;

  /** Function to sign messages with the user's wallet */
  public readonly walletSignFn: (
    message: Uint8Array | string,
  ) => Promise<Uint8Array>;

  /** Function to sign messages with the user's session key */
  public readonly sessionSignFn: (message: Uint8Array) => Promise<Uint8Array>;

  /** Function to sign transactions with the user's wallet */
  public readonly transactionSignFn: <T extends Transaction>(
    tx: T,
  ) => Promise<T>;

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

  /** Current session ID */
  public sessionId?: bigint;

  /** User's public key */
  public publicKey: PublicKey;

  /** Session public key */
  public sessionPubKey: Uint8Array;

  /** Last timestamp used */
  public lastTs = 0;

  /** Last nonce used */
  public lastNonce = 0;

  /** Solana connection */
  public connection: Connection;

  /** SPL token information */
  public splTokenInfos: SPLTokenInfo[] = [];

  /**
   * Create a new NordUser instance
   *
   * @param params - Parameters for creating a NordUser
   * @throws {NordError} If required parameters are missing
   */
  constructor({
    address,
    nord,
    publicKey,
    sessionPubKey,
    sessionSignFn,
    transactionSignFn,
    walletSignFn,
    connection,
    sessionId,
  }: NordUserParams) {
    if (!walletSignFn) {
      throw new NordError("Wallet sign function is required");
    }
    if (!sessionSignFn) {
      throw new NordError("Session sign function is required");
    }
    if (!sessionPubKey) {
      throw new NordError("Session public key is required");
    }

    try {
      this.address = new PublicKey(address);
    } catch (error) {
      throw new NordError("Invalid Solana address", { cause: error });
    }

    this.nord = nord;
    this.walletSignFn = walletSignFn;
    this.sessionSignFn = sessionSignFn;
    this.transactionSignFn = transactionSignFn;
    this.sessionPubKey = sessionPubKey;
    this.publicKey = publicKey;
    this.connection =
      connection ||
      new Connection(nord.solanaUrl, {
        commitment: "confirmed",
      });

    // Set sessionId if provided
    if (sessionId !== undefined) {
      this.sessionId = sessionId;
    }

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
   * Create a clone of this NordUser instance
   *
   * @returns A new NordUser instance with the same properties
   */
  clone(): NordUser {
    const cloned = new NordUser({
      nord: this.nord,
      address: this.address.toBase58(),
      walletSignFn: this.walletSignFn,
      sessionSignFn: this.sessionSignFn,
      transactionSignFn: this.transactionSignFn,
      connection: this.connection,
      sessionPubKey: this.sessionPubKey,
      publicKey: this.publicKey,
    });

    // Copy other properties
    cloned.balances = { ...this.balances };
    cloned.positions = { ...this.positions };
    cloned.margins = { ...this.margins };
    cloned.accountIds = this.accountIds ? [...this.accountIds] : undefined;
    cloned.sessionId = this.sessionId;
    cloned.publicKey = this.publicKey;
    cloned.lastTs = this.lastTs;
    cloned.lastNonce = this.lastNonce;
    cloned.splTokenInfos = [...this.splTokenInfos];

    return cloned;
  }

  /**
   * Create a NordUser from a private key
   *
   * @param nord - Nord instance
   * @param privateKey - Private key as string or Uint8Array
   * @param connection - Solana connection (optional)
   * @returns NordUser instance
   * @throws {NordError} If the private key is invalid
   */
  static fromPrivateKey(
    nord: Nord,
    privateKey: string | Uint8Array,
    connection?: Connection,
  ): NordUser {
    try {
      const keypair = keypairFromPrivateKey(privateKey);
      const publicKey = keypair.publicKey;

      // Create a signing function that uses the keypair but doesn't expose it
      const walletSignFn = async (
        message: Uint8Array | string,
      ): Promise<Uint8Array> => {
        function toHex(buffer: Uint8Array) {
          return Array.from(buffer)
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
        }
        const messageBuffer = new TextEncoder().encode(
          toHex(message as Uint8Array),
        );

        // Use ed25519 to sign the message
        const signature = ed.sign(
          messageBuffer,
          keypair.secretKey.slice(0, 32),
        );
        return signature;
      };

      const sessionSignFn = async (
        message: Uint8Array,
      ): Promise<Uint8Array> => {
        // Use ed25519 to sign the message
        return ed.sign(message, keypair.secretKey.slice(0, 32));
      };

      // Create a transaction signing function
      const transactionSignFn = async (transaction: any): Promise<any> => {
        // This is a basic implementation - actual implementation would depend on the transaction type
        if (transaction.sign) {
          // Solana transaction
          transaction.sign(keypair);
          return transaction;
        }

        // For other transaction types, would need specific implementation
        throw new NordError("Unsupported transaction type for signing");
      };

      return new NordUser({
        nord,
        address: publicKey.toBase58(),
        walletSignFn,
        sessionSignFn,
        transactionSignFn,
        connection,
        publicKey,
        sessionPubKey: publicKey.toBytes(), // Use the public key derived from the private key as the session public key
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
    if (!this.getSolanaPublicKey()) {
      throw new NordError(
        "Solana public key is required to get associated token account",
      );
    }

    try {
      // Get the token program ID from the mint account
      const mintAccount = await this.connection.getAccountInfo(mint);
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
        this.getSolanaPublicKey(),
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
   * Deposit SPL tokens to the bridge
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
   * Deposit SPL tokens to the bridge
   *
   * @param amount - Amount to deposit
   * @param tokenId - Token ID
   * @param recipient - Recipient address; defaults to the user's address
   * @returns Transaction signature
   * @throws {NordError} If required parameters are missing or operation fails
   */
  async deposit({
    amount,
    tokenId,
    recipient,
  }: Readonly<{
    amount: number;
    tokenId: number;
    recipient?: PublicKey;
  }>): Promise<string> {
    try {
      // Find the token info
      const tokenInfo = this.splTokenInfos.find((t) => t.tokenId === tokenId);
      if (!tokenInfo) {
        throw new NordError(`Token with ID ${tokenId} not found`);
      }

      const mint = new PublicKey(tokenInfo.mint);
      const fromAccount = await this.getAssociatedTokenAccount(mint);
      const payer = this.getSolanaPublicKey();

      const { ix, extraSigner } = await this.nord.protonClient.buildDepositIx({
        payer,
        recipient: recipient ?? payer,
        quantAmount: floatToScaledBigIntLossy(amount, tokenInfo.precision),
        mint,
        sourceTokenAccount: fromAccount,
      });

      const { blockhash } =
        await this.connection.getLatestBlockhash("confirmed");
      const tx = new Transaction();

      tx.add(ix);
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer;

      const signedTx = await this.transactionSignFn(tx);
      signedTx.partialSign(extraSigner);

      const signature = await this.connection.sendRawTransaction(
        signedTx.serialize(),
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
    return ++this.lastNonce;
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
          this.balances[accountData.accountId].push({
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
    this.sessionId = await createSession(
      this.nord.webServerUrl,
      this.walletSignFn,
      await this.nord.getTimestamp(),
      this.getNonce(),
      {
        userPubkey: optExpect(this.publicKey.toBytes(), "No user's public key"),
        sessionPubkey: this.sessionPubKey,
      },
    );
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
        this.nord.webServerUrl,
        this.walletSignFn,
        await this.nord.getTimestamp(),
        this.getNonce(),
        {
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
      const { actionId } = await withdraw(
        this.nord.webServerUrl,
        this.sessionSignFn,
        await this.nord.getTimestamp(),
        this.getNonce(),
        {
          sizeDecimals: findToken(this.nord.tokens, tokenId).decimals,
          sessionId: optExpect(this.sessionId, "No session"),
          tokenId: tokenId,
          amount,
        },
      );
      return { actionId };
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
   * @param params - Order parameters
   * @returns Order ID if successful
   * @throws {NordError} If the operation fails
   */
  async placeOrder(params: PlaceOrderParams): Promise<bigint | undefined> {
    try {
      this.checkSessionValidity();
      const market = findMarket(this.nord.markets, params.marketId);
      if (!market) {
        throw new NordError(`Market with ID ${params.marketId} not found`);
      }

      return placeOrder(
        this.nord.webServerUrl,
        this.sessionSignFn,
        await this.nord.getTimestamp(),
        this.getNonce(),
        {
          sessionId: optExpect(this.sessionId, "No session"),
          senderId: params.accountId,
          sizeDecimals: market.sizeDecimals,
          priceDecimals: market.priceDecimals,
          marketId: params.marketId,
          side: params.side,
          fillMode: params.fillMode,
          isReduceOnly: params.isReduceOnly,
          size: params.size,
          price: params.price,
          quoteSize: params.quoteSize,
        },
      );
    } catch (error) {
      throw new NordError("Failed to place order", { cause: error });
    }
  }

  /**
   * Cancel an order
   *
   * @param orderId - Order ID to cancel
   * @param providedAccountId - Account ID that placed the order
   * @returns Action ID if successful
   * @throws {NordError} If the operation fails
   */
  async cancelOrder(
    orderId: BigIntValue,
    providedAccountId?: number,
  ): Promise<bigint> {
    const accountId =
      providedAccountId != null ? providedAccountId : this.accountIds?.[0];
    try {
      this.checkSessionValidity();
      return cancelOrder(
        this.nord.webServerUrl,
        this.sessionSignFn,
        await this.nord.getTimestamp(),
        this.getNonce(),
        {
          sessionId: optExpect(this.sessionId, "No session"),
          senderId: accountId,
          orderId,
        },
      );
    } catch (error) {
      throw new NordError(`Failed to cancel order ${orderId}`, {
        cause: error,
      });
    }
  }

  /**
   * Transfer tokens to another account
   *
   * @param params - Transfer parameters
   * @throws {NordError} If the operation fails
   */
  async transferToAccount(params: TransferParams): Promise<void> {
    try {
      this.checkSessionValidity();
      const token = findToken(this.nord.tokens, params.tokenId);

      await transfer(
        this.nord.webServerUrl,
        this.sessionSignFn,
        await this.nord.getTimestamp(),
        this.getNonce(),
        {
          sessionId: optExpect(this.sessionId, "No session"),
          fromAccountId: optExpect(params.fromAccountId, "No source account"),
          toAccountId: optExpect(params.toAccountId, "No target account"),
          tokenId: params.tokenId,
          tokenDecimals: token.decimals,
          amount: params.amount,
        },
      );
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
  ): Promise<proto.Receipt_AtomicResult> {
    try {
      this.checkSessionValidity();

      const accountId =
        providedAccountId != null ? providedAccountId : this.accountIds?.[0];

      if (accountId == null) {
        throw new NordError(
          "Account ID is undefined. Make sure to call updateAccountId() before atomic operations.",
        );
      }

      const apiActions: ApiAtomicSubaction[] = userActions.map((act) => {
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
            quoteSizeSize: act.quoteSize, // treated as quote size; we pass only size component
            quoteSizePrice: undefined,
            clientOrderId: act.clientOrderId,
          } as ApiAtomicSubaction;
        }
        return {
          kind: "cancel",
          orderId: act.orderId,
        } as ApiAtomicSubaction;
      });

      const result = await atomicAction(
        this.nord.webServerUrl,
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

    if (!this.connection || !this.getSolanaPublicKey()) {
      throw new NordError(
        "Connection and Solana public key are required to get Solana balances",
      );
    }

    const balances: { [symbol: string]: number } = {};
    const tokenAccounts: { [symbol: string]: string } = {};

    try {
      // Get SOL balance (native token)
      const solBalance = await this.retryWithBackoff(
        () => this.connection!.getBalance(this.getSolanaPublicKey()),
        maxRetries,
      );
      balances["SOL"] = solBalance / 1e9; // Convert lamports to SOL
      if (includeTokenAccounts) {
        tokenAccounts["SOL"] = this.getSolanaPublicKey().toString();
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
                () =>
                  getAssociatedTokenAddress(mint, this.getSolanaPublicKey()),
                maxRetries,
              );

              if (includeTokenAccounts) {
                tokenAccounts[token.symbol] = associatedTokenAddress.toString();
              }

              try {
                const tokenBalance = await this.retryWithBackoff(
                  () =>
                    this.connection.getTokenAccountBalance(
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

  /**
   * Get the Solana public key derived from the address
   *
   * @returns The Solana public key
   */
  getSolanaPublicKey(): PublicKey {
    return this.address;
  }
}
