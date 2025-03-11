import { AggregateMetrics, PeakTpsPeriodUnit } from "../../types";
import { checkedFetch } from "../../utils";
import { NordError } from "../utils/NordError";

/**
 * Time periods for metrics queries
 */
export enum MetricPeriod {
  ONE_MINUTE = "1m",
  FIVE_MINUTES = "5m",
  FIFTEEN_MINUTES = "15m",
  ONE_HOUR = "1h",
  FOUR_HOURS = "4h",
  ONE_DAY = "24h",
  ONE_WEEK = "7d",
}

/**
 * Fetch aggregate metrics from the Nord API
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @param txPeakTpsPeriod - Period for peak TPS calculation
 * @param txPeakTpsPeriodUnit - Unit for peak TPS period
 * @returns Aggregate metrics
 * @throws {NordError} If the request fails
 */
export async function aggregateMetrics(
  webServerUrl: string,
  txPeakTpsPeriod = 1,
  txPeakTpsPeriodUnit: PeakTpsPeriodUnit = PeakTpsPeriodUnit.Day,
): Promise<AggregateMetrics> {
  try {
    const response = await checkedFetch(
      `${webServerUrl}/metrics?tx_peak_tps_period=${txPeakTpsPeriod}&tx_peak_tps_period_unit=${txPeakTpsPeriodUnit}`,
    );
    return await response.json();
  } catch (error) {
    throw new NordError("Failed to fetch aggregate metrics", { cause: error });
  }
}

/**
 * Get current transactions per second
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @param period - Time period for the query
 * @returns Current TPS value
 * @throws {NordError} If the request fails
 */
export async function getCurrentTps(
  webServerUrl: string,
  period: string = "1m",
): Promise<number> {
  try {
    return await queryPrometheus(
      webServerUrl,
      `sum(rate(nord_tx_count[${period}]))`,
    );
  } catch (error) {
    throw new NordError(`Failed to get current TPS for period ${period}`, {
      cause: error,
    });
  }
}

/**
 * Get peak transactions per second
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @param period - Time period for the query
 * @returns Peak TPS value
 * @throws {NordError} If the request fails
 */
export async function getPeakTps(
  webServerUrl: string,
  period: string = "24h",
): Promise<number> {
  try {
    return await queryPrometheus(
      webServerUrl,
      `max_over_time(sum(rate(nord_tx_count[1m]))[${period}:])`,
    );
  } catch (error) {
    throw new NordError(`Failed to get peak TPS for period ${period}`, {
      cause: error,
    });
  }
}

/**
 * Get median transaction latency
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @param period - Time period for the query
 * @returns Median latency in milliseconds
 * @throws {NordError} If the request fails
 */
export async function getMedianLatency(
  webServerUrl: string,
  period: string = "1m",
): Promise<number> {
  try {
    return await queryPrometheus(
      webServerUrl,
      `quantile_over_time(0.5, nord_tx_latency_ms[${period}])`,
    );
  } catch (error) {
    throw new NordError(`Failed to get median latency for period ${period}`, {
      cause: error,
    });
  }
}

/**
 * Get total transaction count
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @returns Total transaction count
 * @throws {NordError} If the request fails
 */
export async function getTotalTransactions(
  webServerUrl: string,
): Promise<number> {
  try {
    return await queryPrometheus(webServerUrl, "sum(nord_tx_count)");
  } catch (error) {
    throw new NordError("Failed to get total transactions", { cause: error });
  }
}

/**
 * Query Prometheus metrics
 *
 * @param webServerUrl - Base URL for the Nord web server
 * @param params - Prometheus query parameters
 * @returns Query result as a number
 * @throws {NordError} If the request fails
 */
export async function queryPrometheus(
  webServerUrl: string,
  params: string,
): Promise<number> {
  try {
    const response = await checkedFetch(
      `${webServerUrl}/prometheus?query=${encodeURIComponent(params)}`,
    );
    const data = await response.json();
    return data.data.result[0]?.value[1] || 0;
  } catch (error) {
    throw new NordError(`Failed to query Prometheus: ${params}`, {
      cause: error,
    });
  }
}
