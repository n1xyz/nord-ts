import { ERC20TokenInfo } from "./types";

const NORD_PORT = process.env.NORD_PORT;
const EVM_PORT = process.env.EVM_PORT;
const ROLLMAN_PORT = process.env.ROLLMAN_PORT;
const PROMETHEUS_PORT = process.env.PROMETHEUS_PORT;


export const NORD_BASE_URL = process.env.NORD_BASE_URL!;
export const EVM_BASE_URL = process.env.EVM_BASE_URL!;
export const CHAIN_ID = Number(process.env.CHAIN_ID!);
export const NORD_URL = NORD_BASE_URL + (NORD_PORT?":" + NORD_PORT:"");
export const EVM_URL = EVM_BASE_URL + (EVM_PORT?":" + EVM_PORT:"");
export const ROLLMAN_URL = NORD_BASE_URL +(ROLLMAN_PORT? ":" + ROLLMAN_PORT:"");
export const PROMETHEUS_URL = NORD_BASE_URL + (PROMETHEUS_PORT?":" + PROMETHEUS_PORT:"");

export const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS!
export const TOKEN_INFOS: ERC20TokenInfo[] = process.env.TOKEN_INFOS?JSON.parse(process.env.TOKEN_INFOS!):[];
export const FAUCET_PRIVATE_ADDRESS = process.env.FAUCET_PRIVATE_ADDRESS!

export const DEFAULT_FUNDING_AMOUNTS: { [key: string]: [string, number] } = process.env.DEFAULT_FUNDING_AMOUNTS?JSON.parse(process.env.DEFAULT_FUNDING_AMOUNTS!):{};
