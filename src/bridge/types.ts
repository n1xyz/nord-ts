import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

/**
 * Configuration for Solana bridge
 */
export interface SolanaBridgeConfig {
  /** Solana RPC URL */
  rpcUrl: string;
  /** Program ID for the bridge program */
  programId: string;
  /** Commitment level for transactions */
  commitment: "processed" | "confirmed" | "finalized";
  /** Token information for supported SPL tokens */
  tokenInfos: SPLTokenInfo[];
}

/**
 * Information about an SPL token
 */
export interface SPLTokenInfo {
  /** Token mint address */
  mint: string;
  /** Token decimals */
  precision: number;
  /** Token ID in the Layer-N system */
  tokenId: number;
  /** Token name */
  name: string;
}

/**
 * Parameters for depositing SPL tokens
 */
export interface DepositSplParams {
  /** Amount to deposit (in token's smallest unit) */
  amount: BN;
  /** Mint address of the token to deposit */
  mint: PublicKey;
  /** User's token account to deposit from */
  fromAccount: PublicKey;
  /** Bridge's token account to deposit to */
  toAccount: PublicKey;
}

/**
 * Parameters for withdrawing tokens
 */
export interface WithdrawalParams {
  /** Withdrawal claim data */
  claim: WithdrawalClaim;
  /** User's token account to receive tokens */
  toAccount: PublicKey;
  /** Bridge's token account to withdraw from */
  fromAccount: PublicKey;
}

/**
 * Withdrawal claim data
 */
export interface WithdrawalClaim {
  /** Block ID containing the withdrawal */
  blockId: BN;
  /** Leaf index in the Merkle tree */
  leafIndex: BN;
  /** Amount to withdraw */
  amount: BN;
  /** Recipient address */
  recipient: PublicKey;
  /** Token mint address */
  mint: PublicKey;
  /** Merkle proof for the withdrawal */
  proof: Buffer[];
}

/**
 * Block facts data structure
 */
export interface BlockFacts {
  /** Previous state facts */
  prevStateFacts: StateFacts;
  /** Next state facts */
  nextStateFacts: StateFacts;
  /** Data availability commitment */
  daCommitment: Buffer;
  /** Withdrawal Merkle root */
  withdrawalRoot: Buffer;
}

/**
 * State facts data structure
 */
export interface StateFacts {
  /** Application state commitment */
  appStateCommitment: Buffer;
  /** Deposit root */
  depositRoot: Buffer;
  /** Last deposit index */
  lastDepositIndex: BN;
  /** Last action ID */
  lastActionId: BN;
}

/**
 * Transfer parameters
 */
export interface TransferParams {
  /** User public key */
  user: PublicKey;
  /** Token mint */
  mint: PublicKey;
  /** Amount to transfer */
  amount: BN;
}

/**
 * PDA seed types
 */
export enum PdaSeedType {
  ContractStorage = "contract_storage",
  AssetConfig = "asset_config",
  DepositStorage = "deposit_storage",
  BlockStorage = "block_storage",
  WithdrawalNullifier = "withdrawal_nullifier",
  Authority = "authority",
  DaFactStorage = "da_fact_storage",
}
