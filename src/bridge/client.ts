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
  }

  /**
   * Derive a PDA (Program Derived Address) for the given seeds
   *
   * @param type PDA seed type
   * @param seeds Additional seeds
   * @returns [PDA, bump]
   */
  async findPda(
    type: PdaSeedType,
    ...seeds: (Buffer | PublicKey | string | number)[]
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
        }
        return seed;
      }),
    ];

    return PublicKey.findProgramAddressSync(seedBuffers, this.programId);
  }

  /**
   * Find the contract storage PDA
   *
   * @returns [PDA, bump]
   */
  async findContractStoragePda(): Promise<[PublicKey, number]> {
    return this.findPda(PdaSeedType.ContractStorage);
  }

  /**
   * Find the asset whitelisted PDA for a token mint
   *
   * @param mint Token mint address
   * @returns [PDA, bump]
   */
  async findAssetWhitelistedPda(mint: PublicKey): Promise<[PublicKey, number]> {
    return this.findPda(PdaSeedType.AssetWhitelisted, mint);
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
    return this.findPda(PdaSeedType.DepositStorage, depositIndex);
  }

  /**
   * Find the block storage PDA for a block ID
   *
   * @param blockId Block ID
   * @returns [PDA, bump]
   */
  async findBlockStoragePda(blockId: number): Promise<[PublicKey, number]> {
    return this.findPda(PdaSeedType.BlockStorage, blockId);
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
    const [contractStorage] = await this.findContractStoragePda();
    const [assetWhitelisted] = await this.findAssetWhitelistedPda(params.mint);

    // Get the last deposit index from contract storage
    const contractStorageAccount =
      await this.program.account.contractStorage.fetch(contractStorage);
    const lastDepositIndex = contractStorageAccount.lastDepositIndex.toNumber();

    // Find the deposit PDA for this deposit
    const [deposit] = await this.findDepositStoragePda(lastDepositIndex + 1);

    // Find the previous deposit PDA if it exists
    let prevDeposit: PublicKey | undefined = undefined;
    if (lastDepositIndex > 0) {
      const [prevDepositPda] =
        await this.findDepositStoragePda(lastDepositIndex);
      prevDeposit = prevDepositPda;
    }

    // Build the transaction
    const accounts: any = {
      depositor: this.provider.wallet.publicKey,
      deposit,
      assetWhitelisted,
      contractStorage,
      fromAccount: params.fromAccount,
      toAccount: params.toAccount,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };

    // Create the transaction
    const tx = await this.program.methods
      .depositSpl(params.amount)
      .accounts({ ...accounts, prevDeposit: prevDeposit })
      .transaction();

    // Check if toAccount is initialized and add preinstruction if needed
    try {
      await this.connection.getTokenAccountBalance(params.toAccount);
    } catch {
      // Account doesn't exist, add instruction to create it
      // Get the authority PDA which is the owner of the toAccount
      const [authority] = await this.findAuthorityPda();

      const createTokenAccountIx = createAssociatedTokenAccountInstruction(
        this.provider.wallet.publicKey, // payer
        params.toAccount, // associated token account address
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
    const [contractStorage] = await this.findContractStoragePda();
    const [assetWhitelisted] = await this.findAssetWhitelistedPda(mint);

    // Build the transaction
    const tx = await this.program.methods
      .whitelistAsset(mint)
      .accounts({
        operator: signer.publicKey,
        contractStorage,
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
    const [contractStorage] = await this.findContractStoragePda();

    // Get the last block ID from contract storage
    const contractStorageAccount =
      await this.program.account.contractStorage.fetch(contractStorage);
    const [block] = await this.findBlockStoragePda(
      contractStorageAccount.lastBlockId.toNumber() + 1,
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
        contractStorage,
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
    const [contractStorage] = await this.findContractStoragePda();
    const [block] = await this.findBlockStoragePda(blockId);

    // Build the transaction
    const tx = await this.program.methods
      .finalizeBlock(new anchor.BN(stateUpdateId))
      .accounts({
        payer: signer.publicKey,
        block,
        contractStorage,
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
    const [contractStorage] = await this.findContractStoragePda();

    // Build the transaction
    const tx = await this.program.methods
      .initialize(operator, Array.from(initialAppStateCommitment))
      .accounts({
        payer: signer.publicKey,
        program: this.programId,
        contractStorage,
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
