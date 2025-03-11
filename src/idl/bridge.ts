import { Idl } from "@coral-xyz/anchor";

export const BRIDGE_IDL: Idl = {
  address: "",
  metadata: {
    name: "bridge",
    version: "0.1.0",
    spec: "0.1.0",
    description: "Created with Anchor",
  },
  instructions: [
    {
      name: "deposit_spl",
      discriminator: [224, 0, 198, 175, 198, 47, 105, 204],
      accounts: [
        {
          name: "depositor",
          writable: true,
          signer: true,
        },
        {
          name: "deposit",
          writable: true,
        },
        {
          name: "prev_deposit",
          optional: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  100, 101, 112, 111, 115, 105, 116, 95, 115, 116, 111, 114, 97,
                  103, 101,
                ],
              },
              {
                kind: "account",
                path: "contract_storage.last_deposit_index",
                account: "ContractStorage",
              },
            ],
          },
        },
        {
          name: "asset_whitelisted",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  97, 115, 115, 101, 116, 95, 119, 104, 105, 116, 101, 108, 105,
                  115, 116, 101, 100,
                ],
              },
              {
                kind: "account",
                path: "from_account.mint",
              },
            ],
          },
        },
        {
          name: "contract_storage",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  99, 111, 110, 116, 114, 97, 99, 116, 95, 115, 116, 111, 114,
                  97, 103, 101,
                ],
              },
            ],
          },
        },
        {
          name: "from_account",
          writable: true,
        },
        {
          name: "to_account",
          writable: true,
        },
        {
          name: "token_program",
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111",
        },
      ],
      args: [
        {
          name: "amount",
          type: "u64",
        },
      ],
    },
    {
      name: "finalize_block",
      discriminator: [63, 101, 92, 132, 135, 251, 98, 177],
      accounts: [
        {
          name: "payer",
          writable: true,
          signer: true,
        },
        {
          name: "block",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  98, 108, 111, 99, 107, 95, 115, 116, 111, 114, 97, 103, 101,
                ],
              },
              {
                kind: "arg",
                path: "block_id",
              },
            ],
          },
        },
        {
          name: "contract_storage",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  99, 111, 110, 116, 114, 97, 99, 116, 95, 115, 116, 111, 114,
                  97, 103, 101,
                ],
              },
            ],
          },
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111",
        },
      ],
      args: [
        {
          name: "state_update_id",
          type: "u64",
        },
      ],
    },
    {
      name: "finalize_da_fact",
      discriminator: [6, 135, 30, 141, 5, 246, 223, 58],
      accounts: [
        {
          name: "payer",
          writable: true,
          signer: true,
        },
        {
          name: "fact_state_storage",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  100, 97, 95, 102, 97, 99, 116, 95, 115, 116, 111, 114, 97,
                  103, 101,
                ],
              },
              {
                kind: "arg",
                path: "fact",
              },
            ],
          },
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111",
        },
      ],
      args: [
        {
          name: "fact",
          type: {
            array: ["u8", 32],
          },
        },
      ],
    },
    {
      name: "initialize",
      discriminator: [175, 175, 109, 31, 13, 152, 155, 237],
      accounts: [
        {
          name: "payer",
          writable: true,
          signer: true,
        },
        {
          name: "program",
          signer: true,
          address: "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB",
        },
        {
          name: "contract_storage",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  99, 111, 110, 116, 114, 97, 99, 116, 95, 115, 116, 111, 114,
                  97, 103, 101,
                ],
              },
            ],
          },
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111",
        },
      ],
      args: [
        {
          name: "operator",
          type: "pubkey",
        },
        {
          name: "initial_app_state_commitment",
          type: {
            array: ["u8", 32],
          },
        },
      ],
    },
    {
      name: "propose_block",
      discriminator: [147, 21, 105, 53, 152, 116, 128, 187],
      accounts: [
        {
          name: "operator",
          writable: true,
          signer: true,
        },
        {
          name: "block",
          writable: true,
        },
        {
          name: "last_deposit",
          optional: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  100, 101, 112, 111, 115, 105, 116, 95, 115, 116, 111, 114, 97,
                  103, 101,
                ],
              },
              {
                kind: "arg",
                path: "facts.next_state_facts.last_deposit_index",
              },
            ],
          },
        },
        {
          name: "da_fact_state",
        },
        {
          name: "contract_storage",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  99, 111, 110, 116, 114, 97, 99, 116, 95, 115, 116, 111, 114,
                  97, 103, 101,
                ],
              },
            ],
          },
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111",
        },
      ],
      args: [
        {
          name: "facts",
          type: {
            defined: {
              name: "BlockFacts",
            },
          },
        },
      ],
    },
    {
      name: "whitelist_asset",
      discriminator: [113, 64, 172, 191, 33, 33, 57, 18],
      accounts: [
        {
          name: "operator",
          writable: true,
          signer: true,
        },
        {
          name: "contract_storage",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  99, 111, 110, 116, 114, 97, 99, 116, 95, 115, 116, 111, 114,
                  97, 103, 101,
                ],
              },
            ],
          },
        },
        {
          name: "asset_whitelisted",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  97, 115, 115, 101, 116, 95, 119, 104, 105, 116, 101, 108, 105,
                  115, 116, 101, 100,
                ],
              },
              {
                kind: "arg",
                path: "asset",
              },
            ],
          },
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111",
        },
      ],
      args: [
        {
          name: "asset",
          type: "pubkey",
        },
      ],
    },
    {
      name: "withdraw",
      discriminator: [183, 18, 70, 156, 148, 109, 161, 34],
      accounts: [
        {
          name: "payer",
          writable: true,
          signer: true,
        },
        {
          name: "state_update",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  98, 108, 111, 99, 107, 95, 115, 116, 111, 114, 97, 103, 101,
                ],
              },
              {
                kind: "arg",
                path: "claim.block_id",
              },
            ],
          },
        },
        {
          name: "withdrawal_nullifier",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  119, 105, 116, 104, 100, 114, 97, 119, 97, 108, 95, 110, 117,
                  108, 108, 105, 102, 105, 101, 114,
                ],
              },
              {
                kind: "arg",
                path: "claim.block_id",
              },
              {
                kind: "arg",
                path: "claim.leaf_index",
              },
            ],
          },
        },
        {
          name: "from_account",
          writable: true,
        },
        {
          name: "to_account",
          writable: true,
        },
        {
          name: "authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [97, 117, 116, 104, 111, 114, 105, 116, 121],
              },
            ],
          },
        },
        {
          name: "token_program",
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111",
        },
      ],
      args: [
        {
          name: "claim",
          type: {
            defined: {
              name: "WithdrawalClaim",
            },
          },
        },
      ],
    },
  ],
  accounts: [
    {
      name: "AssetWhitelisted",
      discriminator: [170, 42, 144, 120, 189, 54, 255, 166],
    },
    {
      name: "Block",
      discriminator: [12, 72, 207, 108, 1, 228, 167, 221],
    },
    {
      name: "ContractStorage",
      discriminator: [25, 54, 49, 22, 181, 75, 2, 133],
    },
    {
      name: "Deposit",
      discriminator: [148, 146, 121, 66, 207, 173, 21, 227],
    },
    {
      name: "FactStateStorage",
      discriminator: [98, 222, 3, 112, 154, 244, 201, 242],
    },
    {
      name: "WithdrawalNullifier",
      discriminator: [38, 166, 12, 163, 155, 29, 202, 100],
    },
  ],
  types: [
    {
      name: "AssetWhitelisted",
      type: {
        kind: "struct",
        fields: [],
      },
    },
    {
      name: "Block",
      type: {
        kind: "struct",
        fields: [
          {
            name: "facts",
            type: {
              defined: {
                name: "BlockFacts",
              },
            },
          },
          {
            name: "finalized",
            type: "bool",
          },
        ],
      },
    },
    {
      name: "BlockFacts",
      type: {
        kind: "struct",
        fields: [
          {
            name: "prev_state_facts",
            type: {
              defined: {
                name: "StateFacts",
              },
            },
          },
          {
            name: "next_state_facts",
            type: {
              defined: {
                name: "StateFacts",
              },
            },
          },
          {
            name: "da_commitment",
            type: {
              array: ["u8", 32],
            },
          },
          {
            name: "withdrawal_root",
            type: {
              array: ["u8", 32],
            },
          },
        ],
      },
    },
    {
      name: "ContractStorage",
      type: {
        kind: "struct",
        fields: [
          {
            name: "operator",
            type: "pubkey",
          },
          {
            name: "last_block_id",
            type: "u64",
          },
          {
            name: "last_deposit_index",
            type: "u64",
          },
          {
            name: "fina_block_id",
            type: "u64",
          },
          {
            name: "fina_state_facts",
            type: {
              defined: {
                name: "StateFacts",
              },
            },
          },
        ],
      },
    },
    {
      name: "Deposit",
      type: {
        kind: "struct",
        fields: [
          {
            name: "transfer",
            type: {
              defined: {
                name: "TransferParams",
              },
            },
          },
          {
            name: "prev_deposit_root",
            type: {
              array: ["u8", 32],
            },
          },
        ],
      },
    },
    {
      name: "FactState",
      type: {
        kind: "enum",
        variants: [
          {
            name: "Pending",
          },
          {
            name: "Finalized",
          },
        ],
      },
    },
    {
      name: "FactStateStorage",
      type: {
        kind: "struct",
        fields: [
          {
            name: "state",
            type: {
              defined: {
                name: "FactState",
              },
            },
          },
        ],
      },
    },
    {
      name: "StateFacts",
      type: {
        kind: "struct",
        fields: [
          {
            name: "app_state_commitment",
            type: {
              array: ["u8", 32],
            },
          },
          {
            name: "deposit_root",
            type: {
              array: ["u8", 32],
            },
          },
          {
            name: "last_deposit_index",
            type: "u64",
          },
          {
            name: "last_action_id",
            type: "u64",
          },
        ],
      },
    },
    {
      name: "TransferParams",
      type: {
        kind: "struct",
        fields: [
          {
            name: "user",
            type: "pubkey",
          },
          {
            name: "mint",
            type: "pubkey",
          },
          {
            name: "amount",
            type: "u64",
          },
        ],
      },
    },
    {
      name: "WithdrawalClaim",
      type: {
        kind: "struct",
        fields: [
          {
            name: "user",
            type: "pubkey",
          },
          {
            name: "amount",
            type: "u64",
          },
          {
            name: "block_id",
            type: "u64",
          },
        ],
      },
    },
    {
      name: "WithdrawalNullifier",
      type: {
        kind: "struct",
        fields: [],
      },
    },
  ],
};
