pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract StreamWageFHE is ZamaEthereumConfig {
    struct SalaryStream {
        euint32 encryptedRate;      // Encrypted salary rate per second
        euint32 encryptedTotal;     // Encrypted total salary amount
        uint256 startTime;          // Timestamp when streaming began
        uint256 lastUpdate;         // Last update timestamp
        address employee;           // Employee address
        address employer;           // Employer address
        bool active;                // Stream active status
    }

    mapping(uint256 => SalaryStream) public streams;
    mapping(address => uint256[]) public employeeStreams;
    mapping(address => uint256[]) public employerStreams;

    uint256 public nextStreamId = 1;
    address public owner;

    event StreamCreated(uint256 indexed streamId, address indexed employee, address indexed employer);
    event StreamUpdated(uint256 indexed streamId, uint256 amountUnlocked);
    event StreamClosed(uint256 indexed streamId);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() ZamaEthereumConfig() {
        owner = msg.sender;
    }

    function createStream(
        externalEuint32 encryptedRate,
        externalEuint32 encryptedTotal,
        bytes calldata rateProof,
        bytes calldata totalProof,
        address employee
    ) external {
        require(employee != address(0), "Invalid employee address");

        euint32 rate = FHE.fromExternal(encryptedRate, rateProof);
        euint32 total = FHE.fromExternal(encryptedTotal, totalProof);

        require(FHE.isInitialized(rate), "Invalid encrypted rate");
        require(FHE.isInitialized(total), "Invalid encrypted total");

        uint256 streamId = nextStreamId++;
        streams[streamId] = SalaryStream({
            encryptedRate: rate,
            encryptedTotal: total,
            startTime: block.timestamp,
            lastUpdate: block.timestamp,
            employee: employee,
            employer: msg.sender,
            active: true
        });

        FHE.allowThis(rate);
        FHE.allowThis(total);
        FHE.makePubliclyDecryptable(rate);
        FHE.makePubliclyDecryptable(total);

        employeeStreams[employee].push(streamId);
        employerStreams[msg.sender].push(streamId);

        emit StreamCreated(streamId, employee, msg.sender);
    }

    function updateStream(uint256 streamId) external {
        SalaryStream storage stream = streams[streamId];
        require(stream.active, "Stream inactive");
        require(msg.sender == stream.employee || msg.sender == owner, "Unauthorized");

        uint256 timeElapsed = block.timestamp - stream.lastUpdate;
        require(timeElapsed > 0, "No time elapsed");

        euint32 amountUnlocked = FHE.mul(stream.encryptedRate, FHE.fromUint32(uint32(timeElapsed)));
        euint32 remainingBalance = FHE.sub(stream.encryptedTotal, amountUnlocked);

        require(FHE.isGreaterThanOrEqual(remainingBalance, FHE.fromUint32(0)), "Insufficient balance");

        stream.encryptedTotal = remainingBalance;
        stream.lastUpdate = block.timestamp;

        uint32 decryptedAmount = FHE.decrypt(amountUnlocked);
        emit StreamUpdated(streamId, decryptedAmount);
    }

    function closeStream(uint256 streamId) external {
        SalaryStream storage stream = streams[streamId];
        require(stream.active, "Stream inactive");
        require(msg.sender == stream.employee || msg.sender == stream.employer || msg.sender == owner, "Unauthorized");

        stream.active = false;
        emit StreamClosed(streamId);
    }

    function getStream(uint256 streamId) external view returns (
        euint32 encryptedRate,
        euint32 encryptedTotal,
        uint256 startTime,
        uint256 lastUpdate,
        address employee,
        address employer,
        bool active
    ) {
        SalaryStream storage stream = streams[streamId];
        return (
            stream.encryptedRate,
            stream.encryptedTotal,
            stream.startTime,
            stream.lastUpdate,
            stream.employee,
            stream.employer,
            stream.active
        );
    }

    function getEmployeeStreams(address employee) external view returns (uint256[] memory) {
        return employeeStreams[employee];
    }

    function getEmployerStreams(address employer) external view returns (uint256[] memory) {
        return employerStreams[employer];
    }

    function getTotalStreams() external view returns (uint256) {
        return nextStreamId - 1;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner address");
        owner = newOwner;
    }
}

