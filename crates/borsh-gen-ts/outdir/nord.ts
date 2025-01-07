// GENERATED! DO NOT MODIFY MANUALLY!
// Requires TypeScript v5.0 or later.
import {
  deserialize,
  field,
  fixedArray,
  option,
  serialize,
  variant,
  vec,
} from "@dao-xyz/borsh";
import { OrderedMap } from "@js-sdsl/ordered-map";
import { OrderedSet } from "@js-sdsl/ordered-set";
export class RegistrationKey {
  @field({ type: fixedArray("u8", 33) })
  _0: Uint8Array;
  constructor(data: RegistrationKey) {
    Object.assign(this, data);
  }
}
export class CreateSession {
  @field({ type: RegistrationKey })
  user_pubkey: RegistrationKey;
  @field({ type: fixedArray("u8", 32) })
  blst_key: Uint8Array;
  @field({ type: "i64" })
  expiry_timestamp: bigint;
  constructor(data: CreateSession) {
    Object.assign(this, data);
  }
}
export class RevokeSession {
  @field({ type: "u64" })
  session_id: bigint;
  constructor(data: RevokeSession) {
    Object.assign(this, data);
  }
}
export class CreateToken {
  @field({ type: "u8" })
  token_decimals: number;
  @field({ type: "u16" })
  weight_bps: number;
  @field({ type: "string" })
  view_symbol: string;
  @field({ type: "string" })
  oracle_symbol: string;
  @field({ type: fixedArray("u8", 20) })
  eth_addr: Uint8Array;
  @field({ type: "u64" })
  min_withdraw_amount: bigint;
  constructor(data: CreateToken) {
    Object.assign(this, data);
  }
}

@variant([0, 1])
export class MarketTypeEnum {}

@variant(0)
export class SpotVariant extends MarketTypeEnum {
}

@variant(1)
export class PerpetualsVariant extends MarketTypeEnum {
}
export class Margins {
  @field({ type: "u16" })
  imf_bps: number;
  @field({ type: "u16" })
  cmf_bps: number;
  @field({ type: "u16" })
  mmf_bps: number;
  constructor(data: Margins) {
    Object.assign(this, data);
  }
}
export class CreateMarket {
  @field({ type: "u8" })
  size_decimals: number;
  @field({ type: "u8" })
  price_decimals: number;
  @field({ type: MarketTypeEnum })
  market_type: MarketTypeEnum;
  @field({ type: Margins })
  margins: Margins;
  @field({ type: "string" })
  view_symbol: string;
  @field({ type: "string" })
  oracle_symbol: string;
  @field({ type: "u32" })
  base_token_id: number;
  constructor(data: CreateMarket) {
    Object.assign(this, data);
  }
}

@variant([0, 1])
export class SideEnum {}

@variant(0)
export class AskVariant extends SideEnum {
}

@variant(1)
export class BidVariant extends SideEnum {
}

@variant([0, 1, 2, 3])
export class FillModeEnum {}

@variant(0)
export class LimitVariant extends FillModeEnum {
}

@variant(1)
export class PostOnlyVariant extends FillModeEnum {
}

@variant(2)
export class ImmediateOrCancelVariant extends FillModeEnum {
}

@variant(3)
export class FillOrKillVariant extends FillModeEnum {
}
export class OrderLimits {
  @field({ type: option("NonZeroU64") })
  price: bigint | undefined;
  @field({ type: option("NonZeroU64") })
  base_size: bigint | undefined;
  @field({ type: option("NonZeroU128") })
  quote_size: bigint | undefined;
  constructor(data: OrderLimits) {
    Object.assign(this, data);
  }
}
export class PlaceOrder {
  @field({ type: "u64" })
  session_id: bigint;
  @field({ type: option("u32") })
  sender_id: number | undefined;
  @field({ type: option("u32") })
  delegator_id: number | undefined;
  @field({ type: "u32" })
  market_id: number;
  @field({ type: SideEnum })
  side: SideEnum;
  @field({ type: FillModeEnum })
  fill_mode: FillModeEnum;
  @field({ type: "bool" })
  is_reduce_only: number;
  @field({ type: OrderLimits })
  limits: OrderLimits;
  @field({ type: option("u64") })
  client_order_id: bigint | undefined;
  constructor(data: PlaceOrder) {
    Object.assign(this, data);
  }
}
export class CancelOrderById {
  @field({ type: "u64" })
  session_id: bigint;
  @field({ type: "u64" })
  order_id: bigint;
  @field({ type: option("u32") })
  sender_id: number | undefined;
  @field({ type: option("u32") })
  delegator_id: number | undefined;
  constructor(data: CancelOrderById) {
    Object.assign(this, data);
  }
}
export class Deposit {
  @field({ type: "u64" })
  action_nonce: bigint;
  @field({ type: "u32" })
  token_id: number;
  @field({ type: "u64" })
  amount: bigint;
  @field({ type: RegistrationKey })
  user_pubkey: RegistrationKey;
  constructor(data: Deposit) {
    Object.assign(this, data);
  }
}
export class Withdraw {
  @field({ type: "u32" })
  token_id: number;
  @field({ type: "u64" })
  session_id: bigint;
  @field({ type: "u64" })
  amount: bigint;
  constructor(data: Withdraw) {
    Object.assign(this, data);
  }
}
export class PythSetSymbolFeed {
  @field({ type: "string" })
  oracle_symbol: string;
  @field({ type: fixedArray("u8", 32) })
  price_feed_id: Uint8Array;
  constructor(data: PythSetSymbolFeed) {
    Object.assign(this, data);
  }
}
export class GuardianSet {
  @field({ type: "u32" })
  index: number;
  @field({ type: "string" })
  addresses: string;
  constructor(data: GuardianSet) {
    Object.assign(this, data);
  }
}
export class PriceUpdates {
  @field({ type: "i64" })
  timestamp: bigint;
  @field({ type: "u32" })
  nonce: number;
  @field({ type: "u32" })
  guardian_set_index: number;
  @field({ type: "string" })
  guardians: string;
  @field({ type: "string" })
  updates: string;
  constructor(data: PriceUpdates) {
    Object.assign(this, data);
  }
}
export class Liquidate {
  @field({ type: "u64" })
  liquidator_session_id: bigint;
  @field({ type: option("u32") })
  liquidator_account_id: number | undefined;
  @field({ type: "u32" })
  liquidatee_account_id: number;
  constructor(data: Liquidate) {
    Object.assign(this, data);
  }
}
export class Transfer {
  @field({ type: "u64" })
  session_id: bigint;
  @field({ type: "u32" })
  from_account_id: number;
  @field({ type: option("u32") })
  to_account_id: number | undefined;
  @field({ type: "u32" })
  token_id: number;
  @field({ type: "u64" })
  amount: bigint;
  constructor(data: Transfer) {
    Object.assign(this, data);
  }
}

@variant([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
export class ActionKindEnum {}

@variant(0)
export class CreateSessionVariant extends ActionKindEnum {
  @field({ type: "CreateSession" })
  _0: CreateSession;
}

@variant(1)
export class RevokeSessionVariant extends ActionKindEnum {
  @field({ type: "RevokeSession" })
  _0: RevokeSession;
}

@variant(2)
export class CreateTokenVariant extends ActionKindEnum {
  @field({ type: "CreateToken" })
  _0: CreateToken;
}

@variant(3)
export class CreateMarketVariant extends ActionKindEnum {
  @field({ type: "CreateMarket" })
  _0: CreateMarket;
}

@variant(4)
export class PlaceOrderVariant extends ActionKindEnum {
  @field({ type: "PlaceOrder" })
  _0: PlaceOrder;
}

@variant(5)
export class CancelOrderByIdVariant extends ActionKindEnum {
  @field({ type: "CancelOrderById" })
  _0: CancelOrderById;
}

@variant(6)
export class DepositVariant extends ActionKindEnum {
  @field({ type: "Deposit" })
  _0: Deposit;
}

@variant(7)
export class WithdrawVariant extends ActionKindEnum {
  @field({ type: "Withdraw" })
  _0: Withdraw;
}

@variant(8)
export class PythSetSymbolFeedVariant extends ActionKindEnum {
  @field({ type: "PythSetSymbolFeed" })
  _0: PythSetSymbolFeed;
}

@variant(9)
export class PythSetWormholeGuardiansVariant extends ActionKindEnum {
  @field({ type: "GuardianSet" })
  _0: GuardianSet;
}

@variant(10)
export class PythPriceFeedUpdateVariant extends ActionKindEnum {
  @field({ type: "PriceUpdates" })
  _0: PriceUpdates;
}

@variant(11)
export class LiquidateVariant extends ActionKindEnum {
  @field({ type: "Liquidate" })
  _0: Liquidate;
}

@variant(12)
export class PauseVariant extends ActionKindEnum {
}

@variant(13)
export class UnpauseVariant extends ActionKindEnum {
}

@variant(14)
export class TransferVariant extends ActionKindEnum {
  @field({ type: "Transfer" })
  _0: Transfer;
}
export class Action {
  @field({ type: "i64" })
  timestamp: bigint;
  @field({ type: "u32" })
  nonce: number;
  @field({ type: ActionKindEnum })
  kind: ActionKindEnum;
  constructor(data: Action) {
    Object.assign(this, data);
  }
}
