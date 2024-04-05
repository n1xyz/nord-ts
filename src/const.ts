// DEV SETUP:
import { ERC20TokenInfo } from "./types";

const NORD_PORT = "3000";
const EVM_PORT = "8545";
const ROLLMAN_PORT = "3005";
const PROMETHEUS_PORT = "9090";

export const DEBUG_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
  "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
  "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
];

export const DEV_URL = "http://127.0.0.1";
export const DEV_EVM_URL = "http://127.0.0.1";
export const NORD_DEV_URL = DEV_URL + ":" + NORD_PORT;
export const EVM_DEV_URL = DEV_EVM_URL + ":" + EVM_PORT;
export const ROLLMAN_DEV_URL = DEV_URL + ":" + ROLLMAN_PORT;
export const PROMETHEUS_DEV_URL = DEV_URL + ":" + PROMETHEUS_PORT;


export const DEV_CONTRACT_ADDRESS =
    "0x8a791620dd6260079bf849dc5567adc3f2fdc318";
export const DEV_TOKEN_INFOS: ERC20TokenInfo[] = [
    {
        address: "0x9a9f2ccfde556a7e9ff0848998aa4a0cfd8863ae",
        precision: 6,
        tokenId: 0,
        name: "usdc",
    },
];


export const TESTNET_URL = "http://lmx.layern.network";
export const TESTNET_EVM_URL = "https://rpc.tenderly.co/fork/1143e2fd-db3a-49d6-9326-476f17596e52";
export const NORD_TESTNET_URL = TESTNET_URL;
export const EVM_TESTNET_URL = TESTNET_EVM_URL;
export const ROLLMAN_TESTNET_URL = TESTNET_URL + ":" + ROLLMAN_PORT;
export const PROMETHEUS_TESTNET_URL = TESTNET_URL + ":" + PROMETHEUS_PORT;


export const TESTNET_CONTRACT_ADDRESS =
  "0x1617016e391Ed435cc38286cB9A7fd1Ca643e362";
export const TESTNET_TOKEN_INFOS: ERC20TokenInfo[] = [
  {
    address: "0xfcd861510f6421a759ad8c8fc2bb9ac3c63e850c",
    precision: 6,
    tokenId: 0,
    name: "usdc",
  },
];
export const FAUCET_PRIVATE_ADDRESS =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export const DEFAULT_FUNDING_AMOUNTS: { [key: string]: [string, number] } = {
  ETH: ["0.2", 0],
  "0x9a9f2ccfde556a7e9ff0848998aa4a0cfd8863ae": ["10000", 6],
};
