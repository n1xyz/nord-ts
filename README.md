# nord-ts

This package provides an interface to interact with the Nord exchange. Functionality includes generating Action messages, signing with `Ed25119` and sending payloads. There are also various util functions and interfaces provided.

## Installation

### npm

```bash
npm install nord-ts
```

### yarn

```bash
yarn add nord-ts
```

## Features

- create a new client with a new user and a new session ( `createClient` )
- generate Action messages ( `withdraw` | `placeOrder` | `cancelOrderById` )
- Cryptographic support for `Ed25119` key types.
- Message signing and transmission capabilities.
- Data serialization and deserialization for protobuf.

## Usage

### Basic Example

```typescript
import { Nord, types } from "nord-ts";

const c = await Nord.createClient({url: 'http://localhost:3000'});

const tokenId = 0;

try {
    await c.withdraw(tokenId, 100);
} catch (e) {
    console.log(`couldn't do withdraw, reason: ${e}`)
}

const marketId = 0;
const size = 1;
const price = 1;
const isReduceOnly = false;
let orderID: number = 0;
try {
    orderId = await c.placeOrder(
        marketId,
        Side.Ask,
        FillMode.Limit,
        isReduceOnly,
        size,
        price
    );
} catch (e) {
    console.log(`couldn't do placeOrder, reason: ${e}`)
}

try {
    await c.cancelOrder(
        marketId,
        orderId
    );
} catch (e) {
    console.log(`couldn't do cancelOrder, reason: ${e}`)
}
```
