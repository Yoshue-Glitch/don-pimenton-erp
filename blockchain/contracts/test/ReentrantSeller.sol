// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITrade {
    function createAgreement(string calldata, string calldata, address, uint256, uint256, uint256, uint64) external;
    function releasePayment(string calldata) external;
}

/// @dev Solo para pruebas: vendedor malicioso que intenta reentrar en releasePayment.
contract ReentrantSeller {
    ITrade public trade;
    string public targetId;
    uint256 public attempts;
    bool public reentryBlocked;

    constructor(address t) {
        trade = ITrade(t);
    }

    function create(string calldata id, string calldata lot, address buyer, uint256 amount, uint64 deadline) external {
        targetId = id;
        trade.createAgreement(id, lot, buyer, 200, amount, 300000, deadline);
    }

    function release() external {
        trade.releasePayment(targetId);
    }

    receive() external payable {
        attempts += 1;
        if (attempts == 1) {
            try trade.releasePayment(targetId) {
                reentryBlocked = false;
            } catch {
                reentryBlocked = true;
            }
        }
    }
}
