// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract FileHashRegistry {
    mapping(address => mapping(bytes32 => uint256)) public anchoredAt;

    event FileHashAnchored(address indexed owner, bytes32 indexed fileHash, uint256 timestamp);

    function anchor(bytes32 fileHash) external {
        require(fileHash != bytes32(0), "Empty file hash");
        require(anchoredAt[msg.sender][fileHash] == 0, "Hash already anchored");

        uint256 timestamp = block.timestamp;
        anchoredAt[msg.sender][fileHash] = timestamp;
        emit FileHashAnchored(msg.sender, fileHash, timestamp);
    }
}
