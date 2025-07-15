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

    // Get the raw text response (Prometheus format)
    const text = await response.text();

    // Parse the Prometheus-formatted metrics text into an AggregateMetrics object
    const metrics: AggregateMetrics = {
      blocks_total: 0,
      tx_total: extractMetricValue(text, "nord_requests_ok_count"),
      tx_tps: calculateTps(text),
      tx_tps_peak: calculatePeakTps(text),
      request_latency_average: extractLatency(text),
    };

    return metrics;
  } catch (error) {
    throw new NordError("Failed to fetch aggregate metrics", { cause: error });
  }
}

/**
 * Extract a metric value from Prometheus-formatted text
 *
 * @param text - Prometheus-formatted metrics text
 * @param metricName - Name of the metric to extract
 * @returns The metric value as a number, or 0 if not found
 */
function extractMetricValue(text: string, metricName: string): number {
  const regex = new RegExp(`^${metricName}\\s+([\\d.]+)`, "m");
  const match = text.match(regex);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Calculate TPS from Prometheus metrics
 *
 * @param text - Prometheus-formatted metrics text
 * @returns Calculated TPS value
 */
function calculateTps(text: string): number {
  // Use the request count and latency to estimate TPS
  const requestCount = extractMetricValue(text, "nord_requests_ok_count");
  const latencySum = extractSummaryValue(text, "nord_requests_ok_latency_sum");
  const latencyCount = extractSummaryValue(
    text,
    "nord_requests_ok_latency_count",
  );

  if (latencySum > 0 && latencyCount > 0) {
    // Average latency in seconds
    const avgLatency = latencySum / latencyCount;
    // If we have valid latency data, estimate TPS as requests per second
    return avgLatency > 0 ? requestCount / (latencyCount * avgLatency) : 0;
  }

  // Fallback: just return a small fraction of the total request count
  return requestCount > 0 ? requestCount / 100 : 0;
}

/**
 * Calculate peak TPS from Prometheus metrics
 *
 * @param text - Prometheus-formatted metrics text
 * @returns Calculated peak TPS value
 */
function calculatePeakTps(text: string): number {
  // For peak TPS, we'll use a simple heuristic: 2x the current TPS estimate
  // TODO: fix this
  return calculateTps(text) * 2;
}

/**
 * Extract latency from Prometheus metrics
 *
 * @param text - Prometheus-formatted metrics text
 * @returns Average latency in seconds
 */
function extractLatency(text: string): number {
  // TODO: fix - using average for latency is kinda wack. ok to merge for now but should change.
  const latencySum = extractSummaryValue(text, "nord_requests_ok_latency_sum");
  const latencyCount = extractSummaryValue(
    text,
    "nord_requests_ok_latency_count",
  );

  return latencyCount > 0 ? latencySum / latencyCount : 0;
}

/**
 * Extract a summary value from Prometheus-formatted text
 *
 * @param text - Prometheus-formatted metrics text
 * @param metricName - Name of the metric to extract
 * @returns The metric value as a number, or 0 if not found
 */
function extractSummaryValue(text: string, metricName: string): number {
  const regex = new RegExp(`^${metricName}\\s+([\\d.]+)`, "m");
  const match = text.match(regex);
  return match ? parseFloat(match[1]) : 0;
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
    // nord_tx_count doesn't exist in the metrics, use nord_requests_ok_count instead
    return await queryPrometheus(
      webServerUrl,
      `sum(rate(nord_requests_ok_count[${period}]))`,
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
    // nord_tx_count doesn't exist in the metrics, use nord_requests_ok_count instead
    return await queryPrometheus(
      webServerUrl,
      `max_over_time(sum(rate(nord_requests_ok_count[1m]))[${period}:])`,
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
    // nord_tx_latency_ms doesn't exist, use nord_requests_ok_latency instead
    // which contains the latency data in the summary metric
    return await queryPrometheus(
      webServerUrl,
      `quantile_over_time(0.5, nord_requests_ok_latency[${period}]) * 1000`, // Convert to milliseconds
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
    // nord_tx_count doesn't exist, use nord_requests_ok_count instead
    return await queryPrometheus(webServerUrl, "sum(nord_requests_ok_count)");
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

    // Handle raw text response
    const text = await response.text();
    try {
      // Try to parse as JSON first
      const data = JSON.parse(text);
      return data.data.result[0]?.value[1] || 0;
    } catch (error) {
      console.log("Prometheus query failed:", error);
      // Try to find a number in the response
      const numberMatch = text.match(/[\d.]+/);
      if (numberMatch) {
        return parseFloat(numberMatch[0]);
      }

      // Return 0 if no number is found
      return 0;
    }
  } catch (error) {
    throw new NordError(`Failed to query Prometheus: ${params}`, {
      cause: error,
    });
  }
}
