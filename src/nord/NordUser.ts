import { BrowserProvider, ethers, SigningKey, MaxUint256 } from "ethers";
import secp256k1 from "secp256k1";
import { DEFAULT_FUNDING_AMOUNTS, FAUCET_PRIVATE_ADDRESS } from "../const";
import {
  assert,
  BigIntValue,
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
  balances: { [string: string]: number } = {};
  orders: Order[] = [];
  userId?: number;
  sessionId?: bigint;

  publicKey: Uint8Array | undefined;
  lastTs = 0;
  lastNonce = 0;

  clone(): NordUser {
    const newUser = new NordUser({
      nord: this.nord,
      address: this.address,
      walletSignFn: this.walletSignFn,
      sessionSignFn: this.sessionSignFn,
      userId: this.userId,
      sessionId: this.sessionId,
    });
    newUser.publicKey = this.publicKey;
    newUser.lastTs = this.lastTs;
    newUser.lastNonce = this.lastNonce;
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

  constructor(params: {
    nord: Nord;
    address: string;
    walletSignFn: (message: Uint8Array | string) => Promise<string>;
    sessionSignFn: (message: Uint8Array) => Promise<Uint8Array>;
    userId?: number;
    sessionId?: bigint;
  }) {
    this.nord = params.nord;
    this.address = params.address;
    this.walletSignFn = params.walletSignFn;
    this.sessionSignFn = params.sessionSignFn;
    this.userId = params.userId;
    this.sessionId = params.sessionId;
  }

  async updateUserId() {
    const hexPubkey = ethers
      .hexlify(optExpect(this.publicKey, "No user public key"))
      .slice(2);
    const userId = await (
      await fetch(this.nord.webServerUrl + "/user_id?pubkey=" + hexPubkey)
    ).json();
    if (typeof userId !== "number") {
      this.userId = undefined;
      if (typeof userId === "object" && userId !== null && "error" in userId) {
        throw new Error(`Could not fetch user id: ${userId.error ?? null}`);
      } else {
        throw new Error(`Unknown error: ${userId}`);
      }
    }
    this.userId = userId;
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
    }

    if (this.userId !== undefined) {
      // todo:implement class
      const data_ = await (
        await fetch(this.nord.webServerUrl + "/user?user_id=" + this.userId)
      ).json();
      if (typeof data_ !== "object" || data_ === null) {
        throw new Error(`Unknown data returned: ${data_}`);
      }
      if ("error" in data_) {
        throw new Error(`Failed to fetch user info: ${data_.error}`);
      }
      const data = data_ as Account;
      for (const balance of data.balances) {
        this.balances[balance.token] = balance.amount;
      }
      this.orders = data.orders.map((order) => {
        return {
          orderId: order.orderId,
          isLong: order.side === "bid",
          size: order.size,
          price: order.price,
          marketId: order.marketId,
        };
      });
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
      this.getNonce(),
      {
        userId: optExpect(this.userId, "No user"),
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
    withdraw(this.nord.webServerUrl, this.sessionSignFn, this.getNonce(), {
      sizeDecimals: findToken(this.nord.tokens, tokenId).decimals,
      sessionId: optExpect(this.sessionId, "No session"),
      tokenId: tokenId,
      amount,
    });
  }

  async placeOrder(params: {
    marketId: number;
    side: Side;
    fillMode: FillMode;
    isReduceOnly: boolean;
    size?: Decimal.Value;
    price?: Decimal.Value;
    quoteSize?: Decimal.Value;
  }): Promise<bigint | undefined> {
    const market = findMarket(this.nord.markets, params.marketId);

    return placeOrder(
      this.nord.webServerUrl,
      this.sessionSignFn,
      this.getNonce(),
      {
        sessionId: optExpect(this.sessionId, "No session"),
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

  async cancelOrder(orderId: BigIntValue): Promise<bigint> {
    return cancelOrder(
      this.nord.webServerUrl,
      this.sessionSignFn,
      this.getNonce(),
      {
        sessionId: optExpect(this.sessionId, "No session"),
        orderId,
      },
    );
  }
}
