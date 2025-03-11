import { SPLTokenInfo } from "./types";
import { Commitment } from "@solana/web3.js";

// Solana RPC endpoints
export const SOLANA_MAINNET_URL = "https://api.mainnet-beta.solana.com";
export const SOLANA_DEVNET_URL = "https://api.devnet.solana.com";
export const SOLANA_TESTNET_URL = "https://api.testnet.solana.com";
export const SOLANA_LOCALNET_URL = "http://localhost:8899";

// Default commitment level
export const DEFAULT_COMMITMENT: Commitment = "confirmed";

// Webserver configuration
const WEBSERVER_PORT = "80";
export const DEV_URL = "http://localhost";
export const WEBSERVER_DEV_URL = DEV_URL + ":" + WEBSERVER_PORT;

// Program ID (will be supplied externally)
export const SOLANA_PROGRAM_ID = "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB";

// Sample token information for development
export const DEV_TOKEN_INFOS: SPLTokenInfo[] = [
  {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC on devnet
    precision: 6,
    tokenId: 0,
    name: "usdc",
  },
  {
    mint: "So11111111111111111111111111111111111111112", // Wrapped SOL
    precision: 9,
    tokenId: 1,
    name: "sol",
  },
];

// Default funding amounts for development
export const DEFAULT_FUNDING_AMOUNTS: { [key: string]: [string, number] } = {
  SOL: ["0.2", 9],
  // USDC mint address
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: ["10000", 6],
};

// PDA seed constants
export const PDA_SEEDS = {
  CONTRACT_STORAGE: "contract_storage",
  ASSET_WHITELISTED: "asset_whitelisted",
  DEPOSIT_STORAGE: "deposit_storage",
  BLOCK_STORAGE: "block_storage",
  WITHDRAWAL_NULLIFIER: "withdrawal_nullifier",
  AUTHORITY: "authority",
  DA_FACT_STORAGE: "da_fact_storage",
};
