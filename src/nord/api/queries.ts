import {
  ActionQuery,
  ActionResponse,
  ActionsResponse,
  BlockQuery,
  BlockResponse,
  BlockSummaryResponse,
  RollmanActionResponse,
  RollmanActionsResponse,
  RollmanBlockResponse,
} from "../../types";
import { checkedFetch } from "../../utils";
import { NordError } from "../utils/NordError";

/**
 * Query a specific block
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @param query - Block query parameters
 * @returns Block response
 * @throws {NordError} If the request fails
 */
export async function queryBlock(
  webServerUrl: string,
  query: BlockQuery,
): Promise<BlockResponse> {
  try {
    const params = new URLSearchParams();
    if (query.block_number !== undefined) {
      params.append("block_height", query.block_number.toString());
    }

    const response = await checkedFetch(
      `${webServerUrl}/block?${params.toString()}`,
    );
    return await response.json();
  } catch (error) {
    throw new NordError("Failed to query block", { cause: error });
  }
}

/**
 * Query the last N blocks
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @returns Block response for the last N blocks
 * @throws {NordError} If the request fails
 */
export async function queryLastNBlocks(
  webServerUrl: string,
): Promise<BlockResponse> {
  try {
    const response = await checkedFetch(`${webServerUrl}/blocks`);
    return await response.json();
  } catch (error) {
    throw new NordError("Failed to query last N blocks", { cause: error });
  }
}

/**
 * Query recent blocks
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @param last_n - Number of recent blocks to query
 * @returns Block summary response
 * @throws {NordError} If the request fails
 */
export async function queryRecentBlocks(
  webServerUrl: string,
  last_n: number,
): Promise<BlockSummaryResponse> {
  try {
    const response = await checkedFetch(
      `${webServerUrl}/blocks_summary?last_n=${last_n}`,
    );
    return await response.json();
  } catch (error) {
    throw new NordError(`Failed to query recent blocks (last ${last_n})`, {
      cause: error,
    });
  }
}

/**
 * Query a specific action
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @param query - Action query parameters
 * @returns Action response
 * @throws {NordError} If the request fails
 */
export async function queryAction(
  webServerUrl: string,
  query: ActionQuery,
): Promise<ActionResponse> {
  try {
    const params = new URLSearchParams();
    if (query.action_id !== undefined) {
      params.append("action_id", query.action_id.toString());
    }

    const response = await checkedFetch(
      `${webServerUrl}/action?${params.toString()}`,
    );
    return await response.json();
  } catch (error) {
    throw new NordError("Failed to query action", { cause: error });
  }
}

/**
 * Query recent actions
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @param last_n - Number of recent actions to query
 * @returns Actions response
 * @throws {NordError} If the request fails
 */
export async function queryRecentActions(
  webServerUrl: string,
  last_n: number,
): Promise<ActionsResponse> {
  try {
    const response = await checkedFetch(
      `${webServerUrl}/actions?last_n=${last_n}`,
    );
    return await response.json();
  } catch (error) {
    throw new NordError(`Failed to query recent actions (last ${last_n})`, {
      cause: error,
    });
  }
}

/**
 * Query a block from Rollman
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @param query - Block query parameters
 * @returns Rollman block response
 * @throws {NordError} If the request fails
 */
export async function blockQueryRollman(
  webServerUrl: string,
  query: BlockQuery,
): Promise<RollmanBlockResponse> {
  try {
    const params = new URLSearchParams();
    if (query.block_number !== undefined) {
      params.append("block_height", query.block_number.toString());
    }

    const response = await checkedFetch(
      `${webServerUrl}/rollman/block?${params.toString()}`,
    );
    return await response.json();
  } catch (error) {
    throw new NordError("Failed to query Rollman block", { cause: error });
  }
}

/**
 * Query block summaries from Rollman
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @param last_n - Number of recent blocks to query
 * @returns Block summary response
 * @throws {NordError} If the request fails
 */
export async function blockSummaryQueryRollman(
  webServerUrl: string,
  last_n: number,
): Promise<BlockSummaryResponse> {
  try {
    const response = await checkedFetch(
      `${webServerUrl}/rollman/blocks_summary?last_n=${last_n}`,
    );
    return await response.json();
  } catch (error) {
    throw new NordError(
      `Failed to query Rollman block summaries (last ${last_n})`,
      { cause: error },
    );
  }
}

/**
 * Query an action from Rollman
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @param query - Action query parameters
 * @returns Rollman action response
 * @throws {NordError} If the request fails
 */
export async function actionQueryRollman(
  webServerUrl: string,
  query: ActionQuery,
): Promise<RollmanActionResponse> {
  try {
    const params = new URLSearchParams();
    if (query.action_id !== undefined) {
      params.append("action_id", query.action_id.toString());
    }

    const response = await checkedFetch(
      `${webServerUrl}/rollman/action?${params.toString()}`,
    );
    return await response.json();
  } catch (error) {
    throw new NordError("Failed to query Rollman action", { cause: error });
  }
}

/**
 * Query actions from Rollman
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @param last_n - Number of recent actions to query
 * @returns Rollman actions response
 * @throws {NordError} If the request fails
 */
export async function actionsQueryRollman(
  webServerUrl: string,
  last_n: number,
): Promise<RollmanActionsResponse> {
  try {
    const response = await checkedFetch(
      `${webServerUrl}/rollman/actions?last_n=${last_n}`,
    );
    return await response.json();
  } catch (error) {
    throw new NordError(`Failed to query Rollman actions (last ${last_n})`, {
      cause: error,
    });
  }
}
