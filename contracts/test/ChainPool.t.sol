// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {ChainPool} from "../src/ChainPool.sol";

contract ChainPoolTest is Test {
    ChainPool internal pool;

    uint256 internal alicePk = 0xA11CE;
    uint256 internal bobPk = 0xB0B;
    uint256 internal carolPk = 0xCAFE;

    address internal alice;
    address internal bob;
    address internal carol;

    bytes32 internal constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(uint256 chainId,address from,address to,uint256 amount,uint64 nonce)"
    );

    function setUp() public {
        pool = new ChainPool();
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        carol = vm.addr(carolPk);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(carol, 10 ether);
    }

    function _signTransfer(uint256 pk, ChainPool.TransferMsg memory t)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = pool.transferDigest(t);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _createChain(address creator) internal returns (uint256 id) {
        vm.prank(creator);
        id = pool.createChain(keccak256("seed-commit"), 0);
    }

    function _createChainWithTtl(address creator, uint64 ttl) internal returns (uint256 id) {
        vm.prank(creator);
        id = pool.createChain(keccak256("seed-commit"), ttl);
    }

    // -- happy path: create, deposit, transfer (off-chain), apply, withdraw --
    function test_HappyPath() public {
        uint256 id = _createChain(alice);

        vm.prank(alice);
        pool.deposit{value: 1 ether}(id);
        vm.prank(bob);
        pool.deposit{value: 0.5 ether}(id);

        // alice -> bob 0.3 ether, nonce 1
        ChainPool.TransferMsg memory t1 = ChainPool.TransferMsg({
            chainId: id,
            from: alice,
            to: bob,
            amount: 0.3 ether,
            nonce: 1
        });
        bytes memory sig1 = _signTransfer(alicePk, t1);

        // bob -> alice 0.1 ether, nonce 1
        ChainPool.TransferMsg memory t2 = ChainPool.TransferMsg({
            chainId: id,
            from: bob,
            to: alice,
            amount: 0.1 ether,
            nonce: 1
        });
        bytes memory sig2 = _signTransfer(bobPk, t2);

        ChainPool.TransferMsg[] memory batch = new ChainPool.TransferMsg[](2);
        batch[0] = t1;
        batch[1] = t2;
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = sig1;
        sigs[1] = sig2;

        // any address (carol) can submit
        vm.prank(carol);
        pool.applyTransfers(batch, sigs);

        assertEq(pool.balance(id, alice), 1 ether - 0.3 ether + 0.1 ether);
        assertEq(pool.balance(id, bob), 0.5 ether + 0.3 ether - 0.1 ether);
        assertEq(pool.lastNonce(id, alice), 1);
        assertEq(pool.lastNonce(id, bob), 1);

        // alice withdraws part of her balance
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        pool.withdraw(id, 0.5 ether);
        assertEq(alice.balance, aliceBefore + 0.5 ether);
        assertEq(pool.balance(id, alice), 0.3 ether);
    }

    // -- bad signature must revert --
    function test_BadSignature_Reverts() public {
        uint256 id = _createChain(alice);
        vm.prank(alice);
        pool.deposit{value: 1 ether}(id);

        ChainPool.TransferMsg memory t = ChainPool.TransferMsg({
            chainId: id,
            from: alice,
            to: bob,
            amount: 0.1 ether,
            nonce: 1
        });
        // sign with bob's key but claim from = alice
        bytes memory wrong = _signTransfer(bobPk, t);

        ChainPool.TransferMsg[] memory batch = new ChainPool.TransferMsg[](1);
        batch[0] = t;
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = wrong;

        vm.expectRevert(ChainPool.BadSignature.selector);
        pool.applyTransfers(batch, sigs);
    }

    // -- stale / replayed nonce must revert --
    function test_StaleNonce_Reverts() public {
        uint256 id = _createChain(alice);
        vm.prank(alice);
        pool.deposit{value: 1 ether}(id);

        ChainPool.TransferMsg memory t = ChainPool.TransferMsg({
            chainId: id,
            from: alice,
            to: bob,
            amount: 0.1 ether,
            nonce: 1
        });
        bytes memory sig = _signTransfer(alicePk, t);

        ChainPool.TransferMsg[] memory batch = new ChainPool.TransferMsg[](1);
        batch[0] = t;
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = sig;

        pool.applyTransfers(batch, sigs);

        // replay same payload
        vm.expectRevert(ChainPool.StaleNonce.selector);
        pool.applyTransfers(batch, sigs);
    }

    // -- transfer larger than balance must revert --
    function test_InsufficientBalance_Reverts() public {
        uint256 id = _createChain(alice);
        vm.prank(alice);
        pool.deposit{value: 0.05 ether}(id);

        ChainPool.TransferMsg memory t = ChainPool.TransferMsg({
            chainId: id,
            from: alice,
            to: bob,
            amount: 0.1 ether,
            nonce: 1
        });
        bytes memory sig = _signTransfer(alicePk, t);

        ChainPool.TransferMsg[] memory batch = new ChainPool.TransferMsg[](1);
        batch[0] = t;
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = sig;

        vm.expectRevert(ChainPool.InsufficientBalance.selector);
        pool.applyTransfers(batch, sigs);
    }

    // -- double withdraw must revert second --
    function test_DoubleWithdraw_Reverts() public {
        uint256 id = _createChain(alice);
        vm.prank(alice);
        pool.deposit{value: 0.5 ether}(id);

        vm.prank(alice);
        pool.withdraw(id, 0.5 ether);

        vm.expectRevert(ChainPool.InsufficientBalance.selector);
        vm.prank(alice);
        pool.withdraw(id, 0.5 ether);
    }

    // -- close prevents future deposits --
    function test_ClosePreventsDeposit() public {
        uint256 id = _createChain(alice);

        vm.prank(alice);
        pool.close(id);

        vm.expectRevert(ChainPool.ChainClosed.selector);
        vm.prank(bob);
        pool.deposit{value: 0.1 ether}(id);
    }

    // -- only creator may close --
    function test_OnlyCreatorCloses() public {
        uint256 id = _createChain(alice);
        vm.expectRevert(ChainPool.OnlyCreator.selector);
        vm.prank(bob);
        pool.close(id);
    }

    // -- TTL: deposit allowed before expiry, blocked after --
    function test_TTL_BlocksDepositAfterExpiry() public {
        uint64 ttl = 1 hours;
        uint256 id = _createChainWithTtl(alice, ttl);
        // allowed now
        vm.prank(alice);
        pool.deposit{value: 0.1 ether}(id);
        // jump past expiry
        vm.warp(block.timestamp + ttl + 1);
        vm.expectRevert(ChainPool.ChainExpired.selector);
        vm.prank(bob);
        pool.deposit{value: 0.1 ether}(id);
        // withdraw still works for existing balance
        vm.prank(alice);
        pool.withdraw(id, 0.1 ether);
    }

    // -- TTL: applyTransfers blocked after expiry --
    function test_TTL_BlocksApplyTransfersAfterExpiry() public {
        uint64 ttl = 1 hours;
        uint256 id = _createChainWithTtl(alice, ttl);
        vm.prank(alice);
        pool.deposit{value: 1 ether}(id);

        ChainPool.TransferMsg memory t = ChainPool.TransferMsg({
            chainId: id,
            from: alice,
            to: bob,
            amount: 0.1 ether,
            nonce: 1
        });
        bytes memory sig = _signTransfer(alicePk, t);
        ChainPool.TransferMsg[] memory batch = new ChainPool.TransferMsg[](1);
        batch[0] = t;
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = sig;

        vm.warp(block.timestamp + ttl + 1);
        vm.expectRevert(ChainPool.ChainExpired.selector);
        pool.applyTransfers(batch, sigs);
    }

    // -- isActive helper reflects state --
    function test_TTL_IsActive() public {
        uint256 idForever = _createChain(alice);
        assertTrue(pool.isActive(idForever));

        uint64 ttl = 1 hours;
        uint256 idTtl = _createChainWithTtl(alice, ttl);
        assertTrue(pool.isActive(idTtl));
        vm.warp(block.timestamp + ttl + 1);
        assertFalse(pool.isActive(idTtl));
    }

    // -- digest computed by helper matches the inline computation --
    function test_TransferDigestMatchesEIP712Hand() public view {
        ChainPool.TransferMsg memory t = ChainPool.TransferMsg({
            chainId: 42,
            from: alice,
            to: bob,
            amount: 1 ether,
            nonce: 7
        });
        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_TYPEHASH, t.chainId, t.from, t.to, t.amount, t.nonce)
        );
        bytes32 expected = keccak256(
            abi.encodePacked("\x19\x01", pool.domainSeparator(), structHash)
        );
        assertEq(pool.transferDigest(t), expected);
    }
}
