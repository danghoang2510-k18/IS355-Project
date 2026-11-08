// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IDrugSupplyChain} from "../interfaces/IDrugSupplyChain.sol";

/// @notice Adversarial receiver used only by the contract test suite.
contract ReenteringReceiver is IERC721Receiver {
    IDrugSupplyChain public immutable supply;
    address public immutable nextOwner;
    bool public attempted;
    bool public blocked;

    constructor(address supply_, address nextOwner_) {
        supply = IDrugSupplyChain(supply_);
        nextOwner = nextOwner_;
    }

    function onERC721Received(address, address, uint256 tokenId, bytes calldata) external returns (bytes4) {
        attempted = true;
        try supply.transferOwnership(tokenId, nextOwner, hex"011111111111111111111111112222222222222222222222222222222233333333333333333333333333333333") {
            blocked = false;
        } catch {
            blocked = true;
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}
