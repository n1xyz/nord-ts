import createClient from "openapi-fetch";

import { paths, components } from "../../gen/openapi";

type AccountTriggerInfo = components["schemas"]["AccountTriggerInfo"];
type TriggerHistoryPage =
  components["schemas"]["PageResult_for_uint64_and_HistoryTriggerInfo"];
type HistoryTriggerQuery = components["schemas"]["AccountTriggersQuery"];

export type { AccountTriggerInfo, TriggerHistoryPage, HistoryTriggerQuery };

export async function getAccountTriggers(
  serverUrl: string,
  accountId: number,
): Promise<AccountTriggerInfo[]> {
  const client = createClient<paths>({ baseUrl: serverUrl });
  const response = await client.GET("/account/{account_id}/triggers", {
    params: {
      path: { account_id: accountId },
    },
  });

  if (response.data === undefined) {
    throw new Error(
      `Failed to fetch triggers for account ${accountId}: HTTP ${response.response.status}`,
    );
  }

  return response.data ?? [];
}

export async function getAccountTriggerHistory(
  serverUrl: string,
  accountId: number,
  options: HistoryTriggerQuery,
): Promise<TriggerHistoryPage> {
  const client = createClient<paths>({ baseUrl: serverUrl });
  const response = await client.GET("/account/{account_id}/triggers/history", {
    params: {
      path: { account_id: accountId },
      query: {
        since: options.since,
        until: options.until,
        pageSize: options.pageSize,
        startInclusive: options.startInclusive,
      },
    },
  });

  if (!response.data) {
    throw new Error(
      `Failed to fetch trigger history for account ${accountId}: HTTP ${response.response.status}`,
    );
  }

  return response.data;
}
