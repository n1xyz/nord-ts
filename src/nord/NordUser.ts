import { BrowserProvider, ethers, SigningKey, MaxUint256 } from "ethers";
import secp256k1 from "secp256k1";
import { DEFAULT_FUNDING_AMOUNTS, FAUCET_PRIVATE_ADDRESS } from "../const";
import {
  assert,
  BigIntValue,
  checkedFetch,
  findMarket,
  findToken,
  optExpect,
} from "../utils";
import { ERC20_ABI, NORD_RAMP_FACET_ABI } from "../abis";
import {
  cancelOrder,
  createSession,
  placeOrder,
  revokeSession,
  transfer,
  withdraw,
} from "./actions";
import { FillMode, Order, Side } from "../types";
import { Nord } from "./Nord";
import Decimal from "decimal.js";

export class NordUser {
  nord: Nord;
  address: string;
  walletSignFn: (message: Uint8Array | string) => Promise<string>;
  sessionSignFn: (message: Uint8Array) => Promise<Uint8Array>;
  balances: {
    [key: string]: { accountId: number; balance: number; symbol: string }[];
  } = {};
  orders: { [key: string]: Order[] } = {};
  accountIds?: number[];
  sessionId?: bigint;

  publicKey: Uint8Array | undefined;
  lastTs = 0;
  lastNonce = 0;

  constructor(params: {
    nord: Nord;
    address: string;
    walletSignFn: (message: Uint8Array | string) => Promise<string>;
    sessionSignFn: (message: Uint8Array) => Promise<Uint8Array>;
  }) {
    this.nord = params.nord;
    this.address = params.address;
    this.walletSignFn = params.walletSignFn;
    this.sessionSignFn = params.sessionSignFn;
  }

  clone(): NordUser {
    const newUser = new NordUser({
      nord: this.nord,
      address: this.address,
      walletSignFn: this.walletSignFn,
      sessionSignFn: this.sessionSignFn,
    });
    newUser.publicKey = this.publicKey;
    newUser.lastTs = this.lastTs;
    newUser.lastNonce = this.lastNonce;
    newUser.accountIds = this.accountIds;
    newUser.sessionId = this.sessionId;
    return newUser;
  }

  /**
   * Generates a nonce based on the current timestamp.
   * @returns Generated nonce as a number.
   */
  getNonce(): number {
    const ts = Date.now() / 1000;
    if (ts === this.lastTs) {
      this.lastNonce += 1;
    } else {
      this.lastTs = ts;
      this.lastNonce = 0;
    }
    return this.lastNonce;
  }

  async updateAccountId() {
    const hexPubkey = ethers
      .hexlify(optExpect(this.publicKey, "No user public key"))
      .slice(2);
    const accountIds_ = await (
      await checkedFetch(
        `${this.nord.webServerUrl}/user_account_ids?pubkey=${hexPubkey}`,
      )
    ).json();
    assert(Array.isArray(accountIds_), "Unexpected response");
    const accountIds = accountIds_ as Array<number>;
    this.accountIds = accountIds;
  }

  async fetchInfo() {
    interface FetchOrder {
      orderId: number;
      size: number;
      price: number;
      marketId: number;
      side: "ask" | "bid";
    }

    interface Balance {
      tokenId: number;
      token: string;
      amount: number;
    }

    interface Account {
      orders: FetchOrder[];
      balances: Balance[];
      accountId: number;
    }

    if (this.accountIds !== undefined) {
      // todo:implement class
      const accountsData = await Promise.all(
        this.accountIds.map(async (accountId) => {
          const response = await checkedFetch(
            `${this.nord.webServerUrl}/account?account_id=${accountId}`,
          );
          return {
            accountId,
            ...((await response.json()) as Promise<Account>),
          };
        }),
      );

      for (const accountData of accountsData) {
        this.balances[accountData.accountId] = [];
        for (const balance of accountData.balances) {
          this.balances[accountData.accountId].push({
            accountId: accountData.accountId,
            balance: balance.amount,
            symbol: balance.token,
          });
        }

        this.orders[accountData.accountId] = accountData.orders.map(
          (order: {
            orderId: number;
            side: string;
            size: number;
            price: number;
            marketId: number;
          }) => {
            return {
              orderId: order.orderId,
              isLong: order.side === "bid",
              size: order.size,
              price: order.price,
              marketId: order.marketId,
            };
          },
        );
      }
    }
  }

  async setPublicKey() {
    const message = "Layer N - Nord";
    const msgHash = ethers.hashMessage(message);
    const msgHashBytes = ethers.getBytes(msgHash);
    const signature = await this.walletSignFn(message);
    const recoveredPubKey = SigningKey.recoverPublicKey(
      msgHashBytes,
      signature,
    );
    const publicKeyBuffer = Buffer.from(recoveredPubKey.slice(2), "hex");
    this.publicKey = secp256k1.publicKeyConvert(publicKeyBuffer, true);
  }

  async fundEthWallet() {
    const provider = new ethers.JsonRpcProvider(this.nord.evmUrl);
    const wallet = new ethers.Wallet(FAUCET_PRIVATE_ADDRESS, provider);
    assert(DEFAULT_FUNDING_AMOUNTS["ETH"] != null);
    const ethTx = await wallet.sendTransaction({
      to: this.address,
      value: ethers.parseEther(DEFAULT_FUNDING_AMOUNTS["ETH"][0]),
    });
    await ethTx.wait();
  }

  async fundErc20Wallet() {
    const provider = new ethers.JsonRpcProvider(this.nord.evmUrl);
    const wallet = new ethers.Wallet(FAUCET_PRIVATE_ADDRESS, provider);
    assert(DEFAULT_FUNDING_AMOUNTS["ETH"] != null);
    for (const tokenInfo of this.nord.tokenInfos) {
      const erc20Contract = new ethers.Contract(
        tokenInfo.address,
        ERC20_ABI,
        wallet,
      );
      if (DEFAULT_FUNDING_AMOUNTS[tokenInfo.address]) {
        const defaultFundingAmount = DEFAULT_FUNDING_AMOUNTS[tokenInfo.address];
        const tokenTx = await erc20Contract.transfer(
          this.address,
          ethers.parseUnits(defaultFundingAmount[0], defaultFundingAmount[1]),
          {
            maxFeePerGas: ethers.parseUnits("30", "gwei"),
            maxPriorityFeePerGas: ethers.parseUnits("0.001", "gwei"),
          },
        );
        await tokenTx.wait();
      }
    }
  }

  async refreshSession(sessionPk: Uint8Array): Promise<void> {
    this.sessionId = await createSession(
      this.nord.webServerUrl,
      this.walletSignFn,
      this.nord.impl.getTimestamp(),
      this.getNonce(),
      {
        userPubkey: optExpect(this.publicKey, "No user's public key"),
        sessionPubkey: sessionPk,
      },
    );
  }
  /**
   * Revokes session previously created by user
   *
   * @param sessionId - session identifier
   */
  async revokeSession(sessionId: BigIntValue): Promise<void> {
    return revokeSession(
      this.nord.webServerUrl,
      this.walletSignFn,
      this.nord.impl.getTimestamp(),
      this.getNonce(),
      {
        sessionId,
      },
    );
  }

  async deposit(
    provider: BrowserProvider,
    amount: number,
    tokenId: number,
  ): Promise<void> {
    const erc20 = this.nord.tokenInfos[tokenId];
    const erc20Contract = new ethers.Contract(
      erc20.address,
      ERC20_ABI,
      await provider.getSigner(),
    );

    const approveTx = await erc20Contract.approve(
      this.nord.contractAddress,
      MaxUint256,
      {
        maxFeePerGas: ethers.parseUnits("30", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("0.001", "gwei"),
      },
    );
    await approveTx.wait();
    const nordContract = new ethers.Contract(
      this.nord.contractAddress,
      NORD_RAMP_FACET_ABI,
      await provider.getSigner(),
    );
    const depositTx = await nordContract.depositUnchecked(
      this.publicKey,
      BigInt(0),
      ethers.parseUnits(amount.toString(), erc20.precision),
      {
        maxFeePerGas: ethers.parseUnits("30", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("0.001", "gwei"),
      },
    );
    await depositTx.wait();
  }

  async depositApproveTx(
    provider: BrowserProvider,
    amount: number,
    tokenId: number,
  ): Promise<void> {
    const erc20 = this.nord.tokenInfos[tokenId];
    const erc20Contract = new ethers.Contract(
      erc20.address,
      ERC20_ABI,
      await provider.getSigner(),
    );

    const approveTx = await erc20Contract.approve(
      this.nord.contractAddress,
      MaxUint256,
      {
        maxFeePerGas: ethers.parseUnits("30", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("0.001", "gwei"),
      },
    );
    return approveTx.hash;
  }

  async depositOnlyTx(
    provider: BrowserProvider,
    amount: number,
    tokenId: number,
  ): Promise<void> {
    const erc20 = this.nord.tokenInfos[tokenId];
    const nordContract = new ethers.Contract(
      this.nord.contractAddress,
      NORD_RAMP_FACET_ABI,
      await provider.getSigner(),
    );
    const depositTx = await nordContract.depositUnchecked(
      this.publicKey,
      BigInt(0),
      ethers.parseUnits(amount.toString(), erc20.precision),
      {
        maxFeePerGas: ethers.parseUnits("30", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("0.001", "gwei"),
      },
    );
    return depositTx.hash;
  }

  async depositEth(
    provider: BrowserProvider,
    amount: number,
    tokenId: number,
  ): Promise<void> {
    if (tokenId || tokenId == 0) {
      const nordContract = new ethers.Contract(
        this.nord.contractAddress,
        NORD_RAMP_FACET_ABI,
        await provider.getSigner(),
      );
      const depositTx = await nordContract.depositUnchecked(
        this.publicKey,
        BigInt(1),
        ethers.parseUnits(amount.toString(), 18),
        {
          maxFeePerGas: ethers.parseUnits("30", "gwei"),
          maxPriorityFeePerGas: ethers.parseUnits("0.001", "gwei"),
        },
      );
      await depositTx.wait();
    } else {
      //     todo:implement eth deposits
    }
  }

  async withdraw(tokenId: number, amount: number): Promise<void> {
    withdraw(
      this.nord.webServerUrl,
      this.sessionSignFn,
      this.nord.impl.getTimestamp(),
      this.getNonce(),
      {
        sizeDecimals: findToken(this.nord.tokens, tokenId).decimals,
        sessionId: optExpect(this.sessionId, "No session"),
        tokenId: tokenId,
        amount,
      },
    );
  }

  async placeOrder(params: {
    marketId: number;
    side: Side;
    fillMode: FillMode;
    isReduceOnly: boolean;
    size?: Decimal.Value;
    price?: Decimal.Value;
    quoteSize?: Decimal.Value;
    accountId?: number;
  }): Promise<bigint | undefined> {
    const market = findMarket(this.nord.markets, params.marketId);

    return placeOrder(
      this.nord.webServerUrl,
      this.sessionSignFn,
      this.nord.impl.getTimestamp(),
      this.getNonce(),
      {
        sessionId: optExpect(this.sessionId, "No session"),
        senderId: params.accountId,
        sizeDecimals: market.sizeDecimals,
        priceDecimals: market.priceDecimals,
        marketId: params.marketId,
        side: params.side,
        fillMode: params.fillMode,
        isReduceOnly: params.isReduceOnly,
        size: params.size,
        price: params.price,
        quoteSize: params.quoteSize,
      },
    );
  }

  async cancelOrder(orderId: BigIntValue, accountId: number): Promise<bigint> {
    return cancelOrder(
      this.nord.webServerUrl,
      this.sessionSignFn,
      this.nord.impl.getTimestamp(),
      this.getNonce(),
      {
        sessionId: optExpect(this.sessionId, "No session"),
        senderId: accountId,
        orderId,
      },
    );
  }

  async transferToAccount(params: {
    to: NordUser;
    tokenId: number;
    amount: Decimal.Value;
    fromAccountId: number;
    toAccountId: number;
  }): Promise<void> {
    const token = findToken(this.nord.tokens, params.tokenId);

    await transfer(
      this.nord.webServerUrl,
      this.sessionSignFn,
      this.nord.impl.getTimestamp(),
      this.getNonce(),
      {
        sessionId: optExpect(this.sessionId, "No session"),
        fromAccountId: optExpect(params.fromAccountId, "No source account"),
        toAccountId: optExpect(params.toAccountId, "No target account"),
        tokenId: params.tokenId,
        tokenDecimals: token.decimals,
        amount: params.amount,
      },
    );
  }

  async createAccount(params: {
    tokenId: number;
    amount: Decimal.Value;
  }): Promise<NordUser> {
    const token = findToken(this.nord.tokens, params.tokenId);

    const maybeToAccountId = await transfer(
      this.nord.webServerUrl,
      this.sessionSignFn,
      this.nord.impl.getTimestamp(),
      this.getNonce(),
      {
        sessionId: optExpect(this.sessionId, "No session"),
        fromAccountId: optExpect(this.accountIds?.[0], "No source account"),
        toAccountId: undefined,
        tokenId: params.tokenId,
        tokenDecimals: token.decimals,
        amount: params.amount,
      },
    );

    const toAccountId = optExpect(
      maybeToAccountId,
      "New account should have been created",
    );
    const newUser = this.clone();
    newUser.accountIds?.push(toAccountId);
    await newUser.fetchInfo();

    return newUser;
  }
}
