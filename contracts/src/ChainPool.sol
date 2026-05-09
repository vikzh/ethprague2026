// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title ChainPool
/// @notice One contract == many "pocket chains". Each chain holds a per-user ETH ledger.
///         Chain members exchange off-chain EIP-712 signed Transfer cheques over Waku.
///         Anyone can redeem a batch of cheques on-chain via applyTransfers, which
///         debits senders and credits recipients. Withdraw is direct against a user's
///         on-chain balance — no proofs, no creator role required for funds.
contract ChainPool is EIP712 {
    bytes32 private constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(uint256 chainId,address from,address to,uint256 amount,uint64 nonce)"
    );

    struct Chain {
        bytes32 seedCommit;
        address creator;
        bool closed;
        /// @notice Unix-seconds expiry. 0 = no expiry. After this, the chain
        ///         refuses deposits and transfer redemptions; withdrawals stay
        ///         open so members can drain their balance.
        uint64 expiresAt;
    }

    struct TransferMsg {
        uint256 chainId;
        address from;
        address to;
        uint256 amount;
        uint64 nonce;
    }

    mapping(uint256 => Chain) public chains;
    mapping(uint256 => mapping(address => uint256)) public balance;
    mapping(uint256 => mapping(address => uint64)) public lastNonce;
    uint256 public nextChainId = 1;

    event ChainCreated(
        uint256 indexed id,
        address indexed creator,
        bytes32 seedCommit,
        uint64 expiresAt
    );
    event Deposited(uint256 indexed id, address indexed from, uint256 amount);
    event TransferApplied(
        uint256 indexed id,
        address indexed from,
        address indexed to,
        uint256 amount,
        uint64 nonce
    );
    event Withdrawn(uint256 indexed id, address indexed to, uint256 amount);
    event Closed(uint256 indexed id);

    error UnknownChain();
    error ChainClosed();
    error ChainExpired();
    error LengthMismatch();
    error BadSignature();
    error StaleNonce();
    error InsufficientBalance();
    error TransferFailed();
    error OnlyCreator();

    constructor() EIP712("PocketChains", "1") {}

    /// @param ttlSeconds 0 = no expiry. Otherwise the chain refuses deposits
    ///                  and transfer redemptions after `block.timestamp + ttlSeconds`.
    function createChain(bytes32 seedCommit, uint64 ttlSeconds) external returns (uint256 id) {
        id = nextChainId++;
        uint64 expiresAt = ttlSeconds == 0 ? 0 : uint64(block.timestamp) + ttlSeconds;
        chains[id] = Chain({
            seedCommit: seedCommit,
            creator: msg.sender,
            closed: false,
            expiresAt: expiresAt
        });
        emit ChainCreated(id, msg.sender, seedCommit, expiresAt);
    }

    function _assertActive(uint256 id) internal view {
        Chain storage c = chains[id];
        if (c.creator == address(0)) revert UnknownChain();
        if (c.closed) revert ChainClosed();
        if (c.expiresAt != 0 && block.timestamp >= c.expiresAt) revert ChainExpired();
    }

    function isActive(uint256 id) external view returns (bool) {
        Chain storage c = chains[id];
        if (c.creator == address(0)) return false;
        if (c.closed) return false;
        if (c.expiresAt != 0 && block.timestamp >= c.expiresAt) return false;
        return true;
    }

    function deposit(uint256 id) external payable {
        _assertActive(id);
        balance[id][msg.sender] += msg.value;
        emit Deposited(id, msg.sender, msg.value);
    }

    /// @notice Redeem a batch of off-chain signed Transfer cheques on-chain.
    /// @dev Anyone may submit. Reverts on the first invalid item; submitter must
    ///      filter and sort by (sender, nonce) ascending. Each item is gated on
    ///      its chain still being active — expired chains can't accept new
    ///      transfers (but withdraw stays open).
    function applyTransfers(TransferMsg[] calldata txs, bytes[] calldata sigs) external {
        if (txs.length != sigs.length) revert LengthMismatch();
        for (uint256 i = 0; i < txs.length; i++) {
            TransferMsg calldata t = txs[i];
            _assertActive(t.chainId);
            bytes32 structHash = keccak256(
                abi.encode(TRANSFER_TYPEHASH, t.chainId, t.from, t.to, t.amount, t.nonce)
            );
            address signer = ECDSA.recover(_hashTypedDataV4(structHash), sigs[i]);
            if (signer != t.from) revert BadSignature();
            if (t.nonce <= lastNonce[t.chainId][t.from]) revert StaleNonce();
            uint256 senderBal = balance[t.chainId][t.from];
            if (senderBal < t.amount) revert InsufficientBalance();
            unchecked {
                balance[t.chainId][t.from] = senderBal - t.amount;
                balance[t.chainId][t.to] += t.amount;
            }
            lastNonce[t.chainId][t.from] = t.nonce;
            emit TransferApplied(t.chainId, t.from, t.to, t.amount, t.nonce);
        }
    }

    function withdraw(uint256 id, uint256 amount) external {
        uint256 bal = balance[id][msg.sender];
        if (bal < amount) revert InsufficientBalance();
        unchecked {
            balance[id][msg.sender] = bal - amount;
        }
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(id, msg.sender, amount);
    }

    function close(uint256 id) external {
        Chain storage c = chains[id];
        if (msg.sender != c.creator) revert OnlyCreator();
        c.closed = true;
        emit Closed(id);
    }

    /// @notice Helper for clients to compute the exact digest used in applyTransfers.
    function transferDigest(TransferMsg calldata t) external view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_TYPEHASH, t.chainId, t.from, t.to, t.amount, t.nonce)
        );
        return _hashTypedDataV4(structHash);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
