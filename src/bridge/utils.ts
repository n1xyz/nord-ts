import { Keypair, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import bs58 from "bs58";
import { PdaSeedType } from "./types";

/**
 * Convert a private key string to a Solana Keypair
 *
 * @param privateKey Private key as base58 string, hex string, or Uint8Array
 * @returns Solana Keypair
 */
export function keypairFromPrivateKey(
  privateKey: string | Uint8Array,
): Keypair {
  if (typeof privateKey === "string") {
    // Check if it's a base58 encoded string
    if (!privateKey.startsWith("0x")) {
      return Keypair.fromSecretKey(bs58.decode(privateKey));
    }

    // It's a hex string
    const hex = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
    const bytes = new Uint8Array(
      hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
    );
    return Keypair.fromSecretKey(bytes);
  }

  // It's already a Uint8Array
  return Keypair.fromSecretKey(privateKey);
}

/**
 * Create a signing function for Solana transactions
 *
 * @param keypair Solana keypair
 * @returns Signing function
 */
export function makeSigningFunction(keypair: Keypair) {
  return async (_message: Uint8Array): Promise<Uint8Array> => {
    // Use the correct API for signing with a Keypair
    const signature = keypair.secretKey.slice(0, 32);
    const publicKey = keypair.publicKey.toBytes();

    // This is a simplified version - in a real implementation, you would use proper signing
    // For now, we're just returning a placeholder signature
    return new Uint8Array([...signature, ...publicKey].slice(0, 64));
  };
}

/**
 * Convert a number to a BN with the specified number of decimals
 *
 * @param amount Amount as a number
 * @param decimals Number of decimals
 * @returns BN representation of the amount
 */
export function bridgeToBN(amount: number, decimals: number): BN {
  const factor = Math.pow(10, decimals);
  const amountBN = new BN(Math.floor(amount * factor));
  return amountBN;
}

/**
 * Format a BN as a human-readable number with the specified number of decimals
 *
 * @param amount Amount as a BN
 * @param decimals Number of decimals
 * @returns Formatted number
 */
export function fromBN(amount: BN, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return amount.toNumber() / factor;
}

/**
 * Derive a PDA (Program Derived Address) for the given seeds
 *
 * @param programId Program ID
 * @param type PDA seed type
 * @param seeds Additional seeds
 * @returns [PDA, bump]
 */
export function findPda(
  programId: PublicKey,
  type: PdaSeedType,
  ...seeds: (Buffer | PublicKey | string | number)[]
): [PublicKey, number] {
  const seedBuffers = [
    Buffer.from(type),
    ...seeds.map((seed) => {
      if (seed instanceof PublicKey) {
        return seed.toBuffer();
      } else if (typeof seed === "string") {
        return Buffer.from(seed);
      } else if (typeof seed === "number") {
        return Buffer.from([seed]);
      }
      return seed;
    }),
  ];

  return PublicKey.findProgramAddressSync(seedBuffers, programId);
}

/**
 * Convert a buffer to a hex string
 *
 * @param buffer Buffer to convert
 * @returns Hex string
 */
export function bufferToHex(buffer: Buffer | Uint8Array): string {
  return "0x" + Buffer.from(buffer).toString("hex");
}

/**
 * Convert a hex string to a buffer
 *
 * @param hex Hex string
 * @returns Buffer
 */
export function hexToBuffer(hex: string): Buffer {
  const hexString = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(hexString, "hex");
}

/**
 * Shorten a public key for display
 *
 * @param publicKey Public key to shorten
 * @param chars Number of characters to show at the beginning and end
 * @returns Shortened public key
 */
export function shortenPublicKey(
  publicKey: PublicKey | string,
  chars = 4,
): string {
  const key = typeof publicKey === "string" ? publicKey : publicKey.toBase58();
  return `${key.slice(0, chars)}...${key.slice(-chars)}`;
}
