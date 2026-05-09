// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ChainPool} from "../src/ChainPool.sol";

contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        ChainPool pool = new ChainPool();
        vm.stopBroadcast();
        console2.log("ChainPool deployed at:", address(pool));
        console2.log("Domain separator:");
        console2.logBytes32(pool.domainSeparator());
    }
}
