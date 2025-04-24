import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Idl } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  BlockFacts,
  DepositSplParams,
  PdaSeedType,
  SolanaBridgeConfig,
  WithdrawalParams,
} from "./types";
import { BRIDGE_IDL } from "../idl";

/**
 * Solana Bridge Client for interacting with the bridge program
 */
export class SolanaBridgeClient {
  /** Anchor program instance */
  program: any;
  /** Solana connection */
  connection: Connection;
  /** Program ID */
  programId: PublicKey;
  /** Configuration */
  config: SolanaBridgeConfig;
  /** Anchor provider */
  provider: AnchorProvider;

  bridge: PublicKey;

  /**
   * Create a new Solana Bridge Client
   *
   * @param config Bridge configuration
   * @param wallet Anchor wallet for signing transactions
   */
  constructor(config: SolanaBridgeConfig, wallet: anchor.Wallet) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, {
      commitment: config.commitment,
    });
    this.programId = new PublicKey(config.programId);

    // Create the provider
    const provider = new AnchorProvider(this.connection, wallet, {
      commitment: config.commitment,
      skipPreflight: true, // Skip simulation
    });

    // Set the provider globally
    anchor.setProvider(provider);

    // Store the provider
    this.provider = provider;

    this.program = new anchor.Program(
      { ...(BRIDGE_IDL as Idl), address: config.programId },
      provider,
    );

    this.bridge = new PublicKey(config.bridgeVk);
  }

  /**
   * Derive a PDA (Program Derived Address) for the given seeds
   *
   * Seeds can be of type:
   * - Buffer: raw bytes
   * - PublicKey: Solana public key
   * - string: string encoded as UTF-8 bytes
   * - number: u64 encoded as little-endian 8 bytes
   *
   * @param type PDA seed type
   * @param seeds Additional seeds
   * @returns [PDA, bump]
   */
  async findPda(
    type: PdaSeedType,
    ...seeds: any[]
  ): Promise<[PublicKey, number]> {
    const seedBuffers = [
      Buffer.from(type),
      ...seeds.map((seed) => {
        if (seed instanceof PublicKey) {
          return seed.toBuffer();
        } else if (typeof seed === "string") {
          return Buffer.from(seed);
        } else if (typeof seed === "number") {
          // Convert number to little-endian byte array (8 bytes for u64)
          const buffer = Buffer.alloc(8);
          buffer.writeBigUInt64LE(BigInt(seed), 0);
          return buffer;
        } else {
          return seed.toBytes();
        }
      }),
    ];

    return PublicKey.findProgramAddressSync(seedBuffers, this.programId);
  }

  /**
   * Find the asset config PDA for a token mint
   *
   * @param mint Token mint address
   * @returns [PDA, bump]
   */
  async findAssetConfigPda(mint: PublicKey): Promise<[PublicKey, number]> {
    return this.findPda(PdaSeedType.AssetConfig, this.bridge, mint);
  }

  /**
   * Find the deposit storage PDA for a deposit index
   *
   * @param depositIndex Deposit index
   * @returns [PDA, bump]
   */
  async findDepositStoragePda(
    depositIndex: number,
  ): Promise<[PublicKey, number]> {
    return this.findPda(PdaSeedType.DepositStorage, this.bridge, depositIndex);
  }

  /**
   * Find the block storage PDA for a block ID
   *
   * @param blockId Block ID
   * @returns [PDA, bump]
   */
  async findBlockStoragePda(blockId: number): Promise<[PublicKey, number]> {
    return this.findPda(PdaSeedType.BlockStorage, this.bridge, blockId);
  }

  /**
   * Find the withdrawal nullifier PDA
   *
   * @param blockId Block ID
   * @param leafIndex Leaf index
   * @returns [PDA, bump]
   */
  async findWithdrawalNullifierPda(
    blockId: number,
    leafIndex: number,
  ): Promise<[PublicKey, number]> {
    return this.findPda(PdaSeedType.WithdrawalNullifier, blockId, leafIndex);
  }

  /**
   * Find the authority PDA
   *
   * @returns [PDA, bump]
   */
  async findAuthorityPda(): Promise<[PublicKey, number]> {
    return this.findPda(PdaSeedType.Authority);
  }

  /**
   * Helper method to sign and send a transaction
   *
   * @param transaction Transaction to sign and send
   * @param signers Additional signers (beyond the provider's wallet)
   * @returns Transaction signature
   */
  private async signAndSendTransaction(
    transaction: Transaction,
    signers: Keypair[] = [],
  ): Promise<string> {
    // Use the provider to sign and send the transaction with skipPreflight
    const txSignature = await this.provider.sendAndConfirm(
      transaction,
      signers,
      {
        skipPreflight: true,
      },
    );
    return txSignature;
  }

  /**
   * Deposit SPL tokens to the bridge
   *
   * @param params Deposit parameters
   * @param signer Signer keypair
   * @returns Transaction signature
   */
  async depositSpl(params: DepositSplParams): Promise<string> {
    const [assetConfig] = await this.findAssetConfigPda(params.mint);

    // Get the last deposit index from contract storage
    const bridgeAccount = await this.program.account.bridge.fetch(this.bridge);
    const lastDepositIndex = bridgeAccount.lastDepositIndex.toNumber();

    // Find the deposit PDA for this deposit
    const [deposit] = await this.findDepositStoragePda(lastDepositIndex + 1);

    // Find the previous deposit PDA if it exists
    let prevDeposit: PublicKey | undefined = undefined;
    if (lastDepositIndex > 0) {
      const [prevDepositPda] =
        await this.findDepositStoragePda(lastDepositIndex);
      prevDeposit = prevDepositPda;
    }

    const tokenAuthority = (
      await this.findPda(PdaSeedType.TokenAuthority, this.bridge)
    )[0];
    const crumbAuthority = (
      await this.findPda(PdaSeedType.CrumbAuthority, this.bridge)
    )[0];

    const toAccount = await getAssociatedTokenAddress(
      params.mint,
      tokenAuthority,
      true,
      TOKEN_2022_PROGRAM_ID,
    );

    // Build the transaction
    const accounts: any = {
      payer: this.provider.wallet.publicKey,
      deposit,
      assetConfig,
      bridge: this.bridge,
      program: this.programId,
      fromAccount: params.fromAccount,
      toAccount: toAccount,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      crumbAuthority,
      tokenAuthority,
    };

    const allAccounts = { ...accounts, prevDeposit: prevDeposit };

    // Create the transaction
    const tx = await (
      await this.program.methods
        .deposit(this.provider.wallet.publicKey, params.amount)
        .accounts(allAccounts)
    ).transaction();

    // Check if toAccount is initialized and add preinstruction if needed
    try {
      await this.connection.getTokenAccountBalance(toAccount);
    } catch {
      // Account doesn't exist, add instruction to create it
      // Get the authority PDA which is the owner of the toAccount
      const [authority] = await this.findAuthorityPda();

      const createTokenAccountIx = createAssociatedTokenAccountInstruction(
        this.provider.wallet.publicKey, // payer
        toAccount, // associated token account address
        authority, // owner of the token account
        params.mint, // token mint
        TOKEN_2022_PROGRAM_ID,
      );

      // Add the instruction to the beginning of the transaction
      tx.instructions.unshift(createTokenAccountIx);
    }

    // Sign and send the transaction using our helper method
    return await this.signAndSendTransaction(tx);
  }

  /**
   * Withdraw tokens from the bridge
   *
   * @param params Withdrawal parameters
   * @param signer Signer keypair
   * @returns Transaction signature
   */
  async withdraw(params: WithdrawalParams, signer: Keypair): Promise<string> {
    const [stateUpdate] = await this.findBlockStoragePda(
      params.claim.blockId.toNumber(),
    );
    const [withdrawalNullifier] = await this.findWithdrawalNullifierPda(
      params.claim.blockId.toNumber(),
      params.claim.leafIndex.toNumber(),
    );
    const [authority] = await this.findAuthorityPda();

    // Build the transaction
    const tx = await this.program.methods
      .withdraw(params.claim)
      .accounts({
        payer: signer.publicKey,
        stateUpdate,
        withdrawalNullifier,
        fromAccount: params.fromAccount,
        toAccount: params.toAccount,
        authority,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    // Sign and send the transaction using our helper method
    return await this.signAndSendTransaction(tx, [signer]);
  }

  /**
   * Whitelist an asset (token) for use with the bridge
   *
   * @param mint Token mint address
   * @param signer Operator keypair
   * @returns Transaction signature
   */
  async whitelistAsset(mint: PublicKey, signer: Keypair): Promise<string> {
    const [assetWhitelisted] = await this.findAssetConfigPda(mint);

    // Build the transaction
    const tx = await this.program.methods
      .whitelistAsset(mint)
      .accounts({
        operator: signer.publicKey,
        bridge: this.bridge,
        assetWhitelisted,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    // Sign and send the transaction using our helper method
    return await this.signAndSendTransaction(tx, [signer]);
  }

  /**
   * Propose a new block
   *
   * @param facts Block facts
   * @param signer Operator keypair
   * @returns Transaction signature
   */
  async proposeBlock(facts: BlockFacts, signer: Keypair): Promise<string> {
    // Get the last block ID from contract storage
    const bridgeAccount = await this.program.account.bridge.fetch(this.bridge);
    const [block] = await this.findBlockStoragePda(
      bridgeAccount.lastBlockId.toNumber() + 1,
    );

    // Find the last deposit PDA
    const [lastDeposit] = await this.findDepositStoragePda(
      facts.nextStateFacts.lastDepositIndex.toNumber(),
    );

    // Find the DA fact state
    const daFactState = PublicKey.findProgramAddressSync(
      [Buffer.from(PdaSeedType.DaFactStorage), facts.daCommitment],
      this.programId,
    )[0];

    // Build the transaction
    const tx = await this.program.methods
      .proposeBlock(facts)
      .accounts({
        operator: signer.publicKey,
        block,
        lastDeposit,
        daFactState,
        bridge: this.bridge,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    // Sign and send the transaction using our helper method
    return await this.signAndSendTransaction(tx, [signer]);
  }

  /**
   * Finalize a block
   *
   * @param blockId Block ID
   * @param stateUpdateId State update ID
   * @param signer Payer keypair
   * @returns Transaction signature
   */
  async finalizeBlock(
    blockId: number,
    stateUpdateId: number,
    signer: Keypair,
  ): Promise<string> {
    const [block] = await this.findBlockStoragePda(blockId);

    // Build the transaction
    const tx = await this.program.methods
      .finalizeBlock(new anchor.BN(stateUpdateId))
      .accounts({
        payer: signer.publicKey,
        block,
        bridge: this.bridge,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    // Sign and send the transaction using our helper method
    return await this.signAndSendTransaction(tx, [signer]);
  }

  /**
   * Finalize a DA fact
   *
   * @param fact DA fact (32-byte array)
   * @param signer Payer keypair
   * @returns Transaction signature
   */
  async finalizeDaFact(fact: Buffer, signer: Keypair): Promise<string> {
    const factStateStorage = PublicKey.findProgramAddressSync(
      [Buffer.from(PdaSeedType.DaFactStorage), fact],
      this.programId,
    )[0];

    // Build the transaction
    const tx = await this.program.methods
      .finalizeDaFact(Array.from(fact))
      .accounts({
        payer: signer.publicKey,
        factStateStorage,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    // Sign and send the transaction using our helper method
    return await this.signAndSendTransaction(tx, [signer]);
  }

  /**
   * Initialize the bridge contract
   *
   * @param operator Operator public key
   * @param initialAppStateCommitment Initial app state commitment (32-byte array)
   * @param signer Payer keypair
   * @returns Transaction signature
   */
  async initialize(
    operator: PublicKey,
    initialAppStateCommitment: Buffer,
    signer: Keypair,
  ): Promise<string> {
    // Build the transaction
    const tx = await this.program.methods
      .initialize(operator, Array.from(initialAppStateCommitment))
      .accounts({
        payer: signer.publicKey,
        program: this.programId,
        bridge: this.bridge,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    // Sign and send the transaction using our helper method
    return await this.signAndSendTransaction(tx, [signer]);
  }

  /**
   * Create an associated token account if it doesn't exist
   *
   * @param mint Token mint
   * @param owner Account owner
   * @param payer Transaction payer
   * @returns Associated token account address
   */
  async createTokenAccountIfNeeded(
    mint: PublicKey,
    owner: PublicKey,
    payer: Keypair,
  ): Promise<PublicKey> {
    const associatedTokenAddress = await getAssociatedTokenAddress(mint, owner);

    try {
      await this.connection.getTokenAccountBalance(associatedTokenAddress);
    } catch {
      // Account doesn't exist, create it
      const transaction = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          associatedTokenAddress,
          owner,
          mint,
        ),
      );

      // Sign and send the transaction using our helper method
      await this.signAndSendTransaction(transaction, [payer]);
    }

    return associatedTokenAddress;
  }
}
