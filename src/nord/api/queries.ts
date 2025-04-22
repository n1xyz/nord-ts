import {
  ActionQuery,
  ActionResponse,
  ActionsResponse,
  RollmanActionResponse,
  RollmanActionsResponse,
} from "../../types";
import { checkedFetch } from "../../utils";
import { NordError } from "../utils/NordError";

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
 * @param from - Starting action index
 * @param to - Ending action index
 * @returns Actions response
 * @throws {NordError} If the request fails
 */
export async function queryRecentActions(
  webServerUrl: string,
  from: number,
  to: number,
): Promise<ActionsResponse> {
  try {
    const response = await checkedFetch(
      `${webServerUrl}/actions?from=${from}&to=${to}`,
    );
    return await response.json();
  } catch (error) {
    throw new NordError(
      `Failed to query recent actions (from ${from} to ${to})`,
      {
        cause: error,
      },
    );
  }
}

/**
 * Get the last action ID
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @returns Last action ID
 * @throws {NordError} If the request fails
 */
export async function getLastActionId(webServerUrl: string): Promise<number> {
  try {
    const response = await checkedFetch(`${webServerUrl}/last_actionid`);
    const data = await response.json();
    return data.last_actionid;
  } catch (error) {
    throw new NordError("Failed to get last action ID", {
      cause: error,
    });
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
