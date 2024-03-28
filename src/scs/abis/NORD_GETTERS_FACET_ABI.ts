export const NORD_GETTERS_FACET_ABI = [
    {
        "type": "function",
        "name": "getActionId",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256", "internalType": "uint256"}],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getActionNonce",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256", "internalType": "uint256"}],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getAssetInfo",
        "inputs": [{"name": "assetId", "type": "uint256", "internalType": "uint256"}],
        "outputs": [{"name": "addr", "type": "address", "internalType": "address"}, {
            "name": "decimals",
            "type": "uint8",
            "internalType": "uint8"
        }, {"name": "added", "type": "bool", "internalType": "bool"}],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getBlockId",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256", "internalType": "uint256"}],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getCurrentStateHash",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256", "internalType": "uint256"}],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getDAFactRegistry",
        "inputs": [],
        "outputs": [{"name": "", "type": "address", "internalType": "address"}],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getFraudProofParticipant",
        "inputs": [{"name": "index", "type": "uint256", "internalType": "uint256"}],
        "outputs": [{"name": "", "type": "address", "internalType": "address"}],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getFraudProofParticipantCount",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256", "internalType": "uint256"}],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getFraudProofParticipants",
        "inputs": [],
        "outputs": [{"name": "", "type": "address[]", "internalType": "address[]"}],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getLastFinalizedStateUpdateInfo",
        "inputs": [],
        "outputs": [{"name": "blockId", "type": "uint64", "internalType": "uint64"}, {
            "name": "actionId",
            "type": "uint64",
            "internalType": "uint64"
        }, {"name": "currentStateHash", "type": "uint256", "internalType": "uint256"}],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getNextProposedBlockId",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256", "internalType": "uint256"}],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getOperator",
        "inputs": [{"name": "index", "type": "uint256", "internalType": "uint256"}],
        "outputs": [{"name": "", "type": "address", "internalType": "address"}],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getOperatorCount",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256", "internalType": "uint256"}],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getOperators",
        "inputs": [],
        "outputs": [{"name": "", "type": "address[]", "internalType": "address[]"}],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getPendingDeposit",
        "inputs": [{"name": "owner", "type": "bytes", "internalType": "bytes"}, {
            "name": "assetId",
            "type": "uint256",
            "internalType": "uint256"
        }],
        "outputs": [{"name": "", "type": "uint256", "internalType": "uint256"}],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getPendingFacts",
        "inputs": [{"name": "blockId", "type": "uint256", "internalType": "uint256"}],
        "outputs": [{
            "name": "",
            "type": "tuple",
            "internalType": "struct Types.StateUpdateFacts",
            "components": [{
                "name": "prevStateHash",
                "type": "uint256",
                "internalType": "uint256"
            }, {"name": "pendingStateHash", "type": "uint256", "internalType": "uint256"}, {
                "name": "daFact",
                "type": "uint256",
                "internalType": "uint256"
            }, {
                "name": "onchainUpdatesHash",
                "type": "uint256",
                "internalType": "uint256"
            }, {"name": "startingActionId", "type": "uint64", "internalType": "uint64"}, {
                "name": "endingActionId",
                "type": "uint64",
                "internalType": "uint64"
            }]
        }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getPendingWithdrawal",
        "inputs": [{"name": "owner", "type": "address", "internalType": "address"}, {
            "name": "assetId",
            "type": "uint256",
            "internalType": "uint256"
        }],
        "outputs": [{"name": "", "type": "uint256", "internalType": "uint256"}],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getStateFactRegistry",
        "inputs": [],
        "outputs": [{"name": "", "type": "address", "internalType": "address"}],
        "stateMutability": "view"
    }
]