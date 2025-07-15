# nord-ts

This package provides an interface to interact with the Nord exchange. The core components are `Nord` and `NordUser` classes which enable market data access, trading operations, and account management.

## Installation

```bash
# npm
npm install nord-ts

# yarn
yarn add nord-ts
```

## Key Components

### Nord

The `Nord` class is the main entry point for interacting with the Nord exchange:

- Provides market data access (orderbooks, trades, etc.)
- Manages WebSocket connections for real-time updates
- Offers utility methods for timestamp and nonce generation

### NordUser

The `NordUser` class represents a user account on the Nord exchange:

- Handles authentication and session management
- Provides trading functionality (place/cancel orders)
- Manages deposits and withdrawals
- Tracks user balances, positions, and orders

## Usage Examples

### Initializing Nord

```typescript
import { Nord } from "nord-ts";

// Create a Nord instance
const nord = new Nord({
  webServerUrl: 'https://api.nord.exchange',
  bridgeVk: 'your_bridge_vk', // Provide the bridge verification key
  solanaUrl: 'https://api.mainnet-beta.solana.com',
});

// Initialize and fetch market data
await Nord.initNord(nord); // Initialize client (derives program ID, fetches info)
```

### Creating a User from Private Key

```typescript
import { Nord, NordUser } from "nord-ts";
import { Connection } from "@solana/web3.js";

// Define Nord configuration
const nordConfig = {
  webServerUrl: 'https://api.nord.exchange',
  bridgeVk: 'your_bridge_vk', // Provide the bridge verification key
  solanaUrl: 'https://api.mainnet-beta.solana.com',
};

// Initialize Nord client asynchronously
const nord = await Nord.initNord(nordConfig);

// Optional Solana connection
const connection = new Connection('https://api.mainnet-beta.solana.com');

// Create user from private key
const user = NordUser.fromPrivateKey(
  nord,
  'your_private_key', // Can be string or Uint8Array
  connection // Optional
);

// Fetch user account information
await user.updateAccountId();
await user.fetchInfo();
```

### Trading Operations

```typescript
import { Nord, NordUser, Side, FillMode } from "nord-ts";

// Assuming nord and user are already initialized

// Place a limit order
try {
  const orderId = await user.placeOrder({
    marketId: 0, // BTC/USDC market
    side: Side.Bid, // Buy
    fillMode: FillMode.Limit,
    isReduceOnly: false,
    size: 0.1, // 0.1 BTC
    price: 50000, // $50,000 per BTC
  });
  
  console.log(`Order placed with ID: ${orderId}`);
  
  // Cancel the order
  await user.cancelOrder(orderId);
} catch (error) {
  console.error(`Trading error: ${error}`);
}
```

### Deposits and Withdrawals

```typescript
import { Nord, NordUser } from "nord-ts";

// Assuming nord and user are already initialized

// Withdraw tokens
try {
  const tokenId = 0; // USDC
  const amount = 100; // 100 USDC
  
  await user.withdraw(tokenId, amount);
  console.log(`Successfully withdrew ${amount} of token ID ${tokenId}`);
} catch (error) {
  console.error(`Withdrawal error: ${error}`);
}

// For Solana SPL tokens
try {
  const tokenId = 1; // SOL
  const amount = 1; // 1 SOL
  
  const txId = await user.depositSpl(amount, tokenId);
  console.log(`Deposit transaction ID: ${txId}`);
} catch (error) {
  console.error(`Deposit error: ${error}`);
}
```

### Market Data

```typescript
import { Nord } from "nord-ts";

// Assuming nord is already initialized

// Get orderbook for a market
const orderbook = await nord.getOrderbook({ marketId: 0 });
console.log('Bids:', orderbook.bids);
console.log('Asks:', orderbook.asks);

// Get recent trades
const trades = await nord.getTrades({ marketId: 0, limit: 10 });
console.log('Recent trades:', trades.trades);

// Subscribe to real-time orderbook updates
const orderbookSub = nord.subscribeOrderbook('BTC/USDC');
orderbookSub.on('update', (data) => {
  console.log('Orderbook update:', data);
});
```

### Account Information


```typescript
import { Nord, NordUser } from "nord-ts";

// Assuming nord and user are already initialized

// Get account information
const accountInfo = await user.fetchInfo();

// Access user balances
console.log('Balances:', user.balances);

// Access user positions
console.log('Positions:', user.positions);

// Access user orders
console.log('Orders:', user.orders);
```

## Development

```bash
# Install dependencies
yarn

# Build the package
yarn build
```

## Documentation

For more detailed documentation, please refer to the source code and inline comments in the `Nord` and `NordUser` classes.
