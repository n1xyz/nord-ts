import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import Decimal from "decimal.js";
import * as nacl from "tweetnacl";
import { SolanaBridgeClient } from "../../bridge/client";
import { SPLTokenInfo } from "../../bridge/types";
import { keypairFromPrivateKey } from "../../bridge/utils";
import { FillMode, Order, Side } from "../../types";
import {
  BigIntValue,
  checkedFetch,
  findMarket,
  findToken,
  optExpect,
  toBN as utilsToBN,
} from "../../utils";
import {
  cancelOrder,
  createSession,
  placeOrder,
  revokeSession,
  transfer,
  withdraw,
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
  transactionSignFn: (transaction: any) => Promise<any>;

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
 * Parameters for creating a new account
 */
export interface CreateAccountParams {
  /** Token ID for initial funding */
  tokenId: number;

  /** Initial funding amount */
  amount: Decimal.Value;
}

/**
 * User class for interacting with the Nord protocol
 */
export class NordUser {
  /** Nord client instance */
  public readonly nord: Nord;

  /** User's blockchain address */
  public readonly address: string;

  /** Function to sign messages with the user's wallet */
  public readonly walletSignFn: (
    message: Uint8Array | string,
  ) => Promise<Uint8Array>;

  /** Function to sign messages with the user's session key */
  public readonly sessionSignFn: (message: Uint8Array) => Promise<Uint8Array>;

  /** Function to sign transactions with the user's wallet */
  public readonly transactionSignFn: (transaction: any) => Promise<any>;

  /** User balances by token symbol */
  public balances: {
    [key: string]: { accountId: number; balance: number; symbol: string }[];
  } = {};

  /** User orders by market symbol */
  public orders: { [key: string]: Order[] } = {};

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

  // Solana-specific properties
  /** Solana bridge client */
  public bridgeClient?: SolanaBridgeClient;

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
  constructor(params: NordUserParams) {
    if (!params.nord) {
      throw new NordError("Nord instance is required");
    }
    if (!params.address) {
      throw new NordError("Address is required");
    }
    if (!params.walletSignFn) {
      throw new NordError("Wallet sign function is required");
    }
    if (!params.sessionSignFn) {
      throw new NordError("Session sign function is required");
    }
    if (!params.sessionPubKey) {
      throw new NordError("Session public key is required");
    }

    this.nord = params.nord;
    this.address = params.address;
    this.walletSignFn = params.walletSignFn;
    this.sessionSignFn = params.sessionSignFn;
    this.transactionSignFn = params.transactionSignFn;
    this.sessionPubKey = params.sessionPubKey;
    this.publicKey = params.publicKey;
    this.connection =
      params.connection ||
      new Connection(params.nord.solanaUrl, {
        commitment: "confirmed",
      });

    // Set sessionId if provided
    if (params.sessionId !== undefined) {
      this.sessionId = params.sessionId;
    }

    // Initialize bridge client if needed
    try {
      this.initBridgeClient();
    } catch (error) {
      console.warn("Failed to initialize bridge client:", error);
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
      address: this.address,
      walletSignFn: this.walletSignFn,
      sessionSignFn: this.sessionSignFn,
      transactionSignFn: this.transactionSignFn,
      connection: this.connection,
      sessionPubKey: this.sessionPubKey,
      publicKey: this.publicKey,
    });

    // Copy other properties
    cloned.balances = { ...this.balances };
    cloned.orders = { ...this.orders };
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
   * Initialize the Solana bridge client
   *
   * @private
   * @throws {NordError} If required parameters are missing
   */
  private initBridgeClient(): void {
    if (
      !this.getSolanaPublicKey() ||
      !this.connection ||
      !this.nord.solanaProgramId
    ) {
      throw new NordError(
        "Solana public key, connection, and program ID are required to initialize bridge client",
      );
    }

    // Create an Anchor wallet that uses walletSignFn for signing
    const wallet: anchor.Wallet = {
      publicKey: this.getSolanaPublicKey(),
      signTransaction: async (tx: any) => {
        return await this.transactionSignFn(tx);
      },
      signAllTransactions: async (txs: any[]) => {
        return Promise.all(
          txs.map(async (tx) => {
            return await this.transactionSignFn(tx);
          }),
        );
      },
      // Create a keypair-like object with just the public key
      payer: {
        publicKey: this.getSolanaPublicKey(),
        secretKey: new Uint8Array(64), // Dummy secret key to satisfy the type
      } as Keypair,
    };

    // Initialize the bridge client
    this.bridgeClient = new SolanaBridgeClient(
      {
        rpcUrl: this.connection.rpcEndpoint,
        programId: this.nord.solanaProgramId,
        commitment: "confirmed",
        tokenInfos: this.splTokenInfos,
      },
      wallet,
    );
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
        const messageBuffer =
          typeof message === "string"
            ? Buffer.from(message)
            : Buffer.from(message);

        // Use the keypair to sign the message
        const signature = nacl.sign.detached(messageBuffer, keypair.secretKey);
        return signature;
      };

      const sessionSignFn = async (
        message: Uint8Array,
      ): Promise<Uint8Array> => {
        // Use the keypair to sign the message
        return nacl.sign.detached(message, keypair.secretKey);
      };

      // Create a transaction signing function
      const transactionSignFn = async (transaction: any): Promise<any> => {
        // This is a basic implementation - actual implementation would depend on the transaction type
        if (transaction.serializeMessage) {
          // Solana transaction
          transaction.sign([keypair]);
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
      return await getAssociatedTokenAddress(
        mint,
        this.getSolanaPublicKey(),
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
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
   * @returns Transaction signature
   * @throws {NordError} If required parameters are missing or operation fails
   */
  async depositSpl(amount: number, tokenId: number): Promise<string> {
    if (!this.bridgeClient || !this.getSolanaPublicKey() || !this.connection) {
      throw new NordError(
        "Bridge client, Solana public key, and connection are required for deposit",
      );
    }

    try {
      // Find the token info
      const tokenInfo = this.splTokenInfos.find((t) => t.tokenId === tokenId);
      if (!tokenInfo) {
        throw new NordError(`Token with ID ${tokenId} not found`);
      }

      const mint = new PublicKey(tokenInfo.mint);
      // Get the user's token account
      const fromAccount = await this.getAssociatedTokenAccount(mint);

      // Get the bridge's token account
      const [authority] = await this.bridgeClient.findAuthorityPda();
      const toAccount = await getAssociatedTokenAddress(
        mint,
        authority,
        true,
        TOKEN_2022_PROGRAM_ID,
      );

      // Convert amount to BN with proper decimals
      const amountBN = utilsToBN(amount, tokenInfo.precision);

      // Deposit tokens
      return await this.bridgeClient.depositSpl({
        amount: amountBN,
        mint,
        fromAccount,
        toAccount,
      });
    } catch (error) {
      throw new NordError(
        `Failed to deposit ${amount} of token ID ${tokenId}`,
        { cause: error },
      );
    }
  }

  /**
   * Withdraw SPL tokens from the bridge
   *
   * @param claim - Claim data
   * @returns Transaction signature
   * @throws {NordError} If required parameters are missing or operation fails
   */
  async withdrawSpl(claim: any): Promise<string> {
    if (!this.bridgeClient || !this.getSolanaPublicKey() || !this.connection) {
      throw new NordError(
        "Bridge client, Solana public key, and connection are required for withdrawal",
      );
    }

    try {
      // Find the token info
      const tokenInfo = this.splTokenInfos.find(
        (t) => t.tokenId === claim.tokenId,
      );
      if (!tokenInfo) {
        throw new NordError(`Token with ID ${claim.tokenId} not found`);
      }

      const mint = new PublicKey(tokenInfo.mint);

      // Get the user's token account
      const toAccount = await this.getAssociatedTokenAccount(mint);

      // Get the bridge's token account
      const [authority] = await this.bridgeClient.findAuthorityPda();
      const fromAccount = await getAssociatedTokenAddress(
        mint,
        authority,
        true,
        TOKEN_2022_PROGRAM_ID,
      );

      // Create a transaction signer that uses walletSignFn
      const transactionSigner = {
        publicKey: this.getSolanaPublicKey(),
        secretKey: new Uint8Array(64), // Dummy secret key, not actually used
        sign: async (tx: Transaction) => {
          const message = tx.serializeMessage();
          await this.walletSignFn(message);
          return tx;
        },
      };

      // Withdraw tokens
      return await this.bridgeClient.withdraw(
        {
          claim,
          fromAccount,
          toAccount,
        },
        transactionSigner as unknown as Keypair, // Type cast to satisfy the API
      );
    } catch (error) {
      throw new NordError("Failed to withdraw SPL tokens", { cause: error });
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

      const resp = await this.nord.getUserAccountIds({
        pubkey: this.publicKey.toBase58(),
      });

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
    interface FetchOrder {
      orderId: number;
      size: number;
      price: number;
      marketId: number;
      side: "ask" | "bid";
      originalOrderSize?: number;
      clientOrderId?: number | null;
    }

    interface Balance {
      tokenId: number;
      token: string;
      amount: number;
    }

    interface Position {
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
    }

    interface Margins {
      omf: number;
      mf: number;
      imf: number;
      cmf: number;
      mmf: number;
      pon: number;
      pn: number;
      bankruptcy: boolean;
    }

    interface Account {
      updateId: number;
      orders: FetchOrder[];
      positions: Position[];
      balances: Balance[];
      margins: Margins;
      actionNonce?: number | null;
      accountId: number;
    }

    if (this.accountIds !== undefined) {
      const accountsData = await Promise.all(
        this.accountIds.map(async (accountId) => {
          const response = await checkedFetch(
            `${this.nord.webServerUrl}/account?account_id=${accountId}`,
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

        // Process orders
        this.orders[accountData.accountId] = accountData.orders.map(
          (order: {
            orderId: number;
            side: string;
            size: number;
            price: number;
            marketId: number;
          }) => {
            return {
              orderId: order.orderId,
              isLong: order.side === "bid",
              size: order.size,
              price: order.price,
              marketId: order.marketId,
            };
          },
        );

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
    console.log(this.publicKey);
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
  async withdraw(tokenId: number, amount: number): Promise<void> {
    try {
      this.checkSessionValidity();
      await withdraw(
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
   * @param accountId - Account ID that placed the order
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
   * Create a new account
   *
   * @param params - Account creation parameters
   * @returns New NordUser instance
   * @throws {NordError} If the operation fails
   */
  async createAccount(params: CreateAccountParams): Promise<NordUser> {
    try {
      this.checkSessionValidity();
      // Create a new keypair for the account
      const keypair = Keypair.generate();

      // Create a new NordUser
      const newUser = NordUser.fromPrivateKey(
        this.nord,
        keypair.secretKey,
        this.connection,
      );

      // Transfer initial funds
      await this.transferToAccount({
        to: newUser,
        tokenId: params.tokenId,
        amount: params.amount,
        fromAccountId: optExpect(this.accountIds?.[0], "No account ID"),
        toAccountId: optExpect(
          newUser.accountIds?.[0],
          "No account ID for new user",
        ),
      });

      return newUser;
    } catch (error) {
      throw new NordError("Failed to create account", { cause: error });
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
                    this.connection!.getTokenAccountBalance(
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
    try {
      return new PublicKey(this.address);
    } catch (error) {
      throw new NordError("Invalid Solana address", { cause: error });
    }
  }
}
