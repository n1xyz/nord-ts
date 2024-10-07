/**
 * Implementation of some functions backing Nord and NordUser as interface,
 * for mocking reasons
 */

export interface NordImpl {
  getTimestamp: () => bigint;
}

export const DefaultNordImpl: NordImpl = {
  getTimestamp: (): bigint => {
    return BigInt(Math.floor(Date.now() / 1000));
  },
};
