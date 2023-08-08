# nord-ts

This package provides an interface to interact with the Nord exchange. Functionality includes generating Action messages, signing with Ed25119, Secp256k1 and Bls12_381, and sending payloads. There are also various util functions and interfaces provided.

## Installation

```bash
npm install nord-ts | yarn add nord-ts
```

## Features

- generate Action messages ( createUser | createSession | deposit | withdraw | placeOrder | cancelOrderById )
- Cryptographic support for `Ed25119`, `Secp256k1`, and `Bls12_381` key types.
- Message signing and transmission capabilities.
- Data serialization and encoding for protobuf.

## Usage

### Basic Example

```typescript
import { Nord, types, utils } from "nord-ts";

import Decimal from "decimal.js";
import { ed25519 } from "@noble/curves/ed25519";
import { bls12_381 as bls } from "@noble/curves/bls12-381";
import { secp256k1 as secp } from "@noble/curves/secp256k1";

const ed25519Sk: Uint8Array = Uint8Array.from([0xff, 0xff, 0xff, ..., 0xff]);
const ed25519Pk: Uint8Array = ed25519.getPublicKey(ed25519Sk);

const blsSk: Uint8Array = Uint8Array.from([0xff, 0xff, 0xff, ..., 0xff]);
const blsPk: Uint8Array = bls.getPublicKeyForShortSignatures(blsSk);

const createUserMsg: Uint8Array = Nord.createUser({
  keyType: types.KeyType.Ed25119,
  pubkey: ed25519Pk,
});
const createUserPayload: Uint8Array = utils.signAction(
  createUserMsg,
  ed25519Sk,
  types.KeyType.Ed25119
);
await utils.sendMessage(createUserPayload);

const createSessionMsg: Uint8Array = Nord.createSession({
  userId,
  blstPubkey: blsPk,
  expiryTs: 1700000000n,
});
const createSessionPayload: Uint8Array = utils.signAction(
  createSessionMsg,
  ed25519Sk,
  types.KeyType.Ed25119
);
await utils.sendMessage(createSessionPayload);


const depositMsg: Uint8Array = Nord.deposit({
  collateralId,
  userId,
  amount: new Decimal("120938128903.1234567"),
});
const depositPayload = utils.signAction(
  depositMsg,
  blsSk,
  types.KeyType.Bls12_381
);
await utils.sendMessage(depositPayload);

const placeOrderMsg: Uint8Array = Nord.placeOrder({
  userId,
  marketId,
  side: types.Side.Bid,
  fillMode: types.FillMode.Limit,
  isReduceOnly: false,
  price: new Decimal("56.3"),
  size: new Decimal("420.567"),
  sessionId,
});
const placeOrderPayload = utils.signAction(
  placeOrderMsg,
  blsSk,
  types.KeyType.Bls12_381
);
await utils.sendMessage(placeOrderPayload);

```
