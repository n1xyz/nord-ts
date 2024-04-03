export const NORD_RAMP_FACET_ABI = [
  {
    type: "function",
    name: "depositUnchecked",
    inputs: [
      { name: "recipient", type: "bytes", internalType: "bytes" },
      {
        name: "assetId",
        type: "uint256",
        internalType: "uint256",
      },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [
      { name: "receiver", type: "address", internalType: "address" },
      {
        name: "assetId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "RampDeposit",
    inputs: [
      {
        name: "caller",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "receiverPublicKey",
        type: "bytes",
        indexed: false,
        internalType: "bytes",
      },
      {
        name: "assetId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "quantizedAmount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "actionNonce",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RampWithdrawal",
    inputs: [
      { name: "user", type: "address", indexed: true, internalType: "address" },
      {
        name: "assetId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "quantizedAmount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AddressEmptyCode",
    inputs: [{ name: "target", type: "address", internalType: "address" }],
  },
  {
    type: "error",
    name: "AddressInsufficientBalance",
    inputs: [{ name: "account", type: "address", internalType: "address" }],
  },
  {
    type: "error",
    name: "AssetNotAdded",
    inputs: [{ name: "assetId", type: "uint256", internalType: "uint256" }],
  },
  { type: "error", name: "FailedInnerCall", inputs: [] },
  {
    type: "error",
    name: "IncorrectAmountTransferred",
    inputs: [{ name: "amount", type: "uint256", internalType: "uint256" }],
  },
  {
    type: "error",
    name: "InvalidAmount",
    inputs: [
      { name: "amount", type: "uint256", internalType: "uint256" },
      {
        name: "quantum",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "InvalidPublicKeyLength",
    inputs: [{ name: "publicKey", type: "bytes", internalType: "bytes" }],
  },
  {
    type: "error",
    name: "InvalidRecipient",
    inputs: [{ name: "recipient", type: "address", internalType: "address" }],
  },
  {
    type: "error",
    name: "QuantizedAmountTooLarge",
    inputs: [{ name: "amount", type: "uint256", internalType: "uint256" }],
  },
  {
    type: "error",
    name: "SafeERC20FailedOperation",
    inputs: [{ name: "token", type: "address", internalType: "address" }],
  },
];
