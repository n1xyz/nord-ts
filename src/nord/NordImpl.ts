/**
 * Implementation of some functions backing Nord and NordUser as interface,
 * for mocking reasons
 */

export interface NordImpl {
  getTimestamp: () => Promise<bigint>;
}
