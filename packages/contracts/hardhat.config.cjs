require('dotenv').config({ path: __dirname + '/.env' });
require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

const ARC_TESTNET_RPC = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io";

// Safety guard: refuse to load if deployer key is missing on a live network.
// The hardhat local network uses a generated account, so the key is not needed there.
const _rawKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!_rawKey || _rawKey.trim() === "") {
  // Only block non-local network usage; local hardhat node generates its own accounts.
  // We defer the actual error to network-selection time by leaving arcTestnet accounts empty.
  console.warn(
    "[hardhat.config] WARNING: DEPLOYER_PRIVATE_KEY is not set. " +
    "Deployment to arcTestnet will fail. Set DEPLOYER_PRIVATE_KEY in packages/contracts/.env"
  );
}
// Only a well-formed 32-byte hex key is ever handed to Hardhat. A malformed value is ignored (and never printed),
// so a typo cannot be mistaken for a working account; scripts/deploy.ts then refuses with a clear message.
const _trimmedKey = _rawKey ? _rawKey.trim() : "";
const _keyIsValid = /^(0x)?[0-9a-fA-F]{64}$/.test(_trimmedKey);
if (_trimmedKey !== "" && !_keyIsValid) {
  console.warn("[hardhat.config] WARNING: DEPLOYER_PRIVATE_KEY is set but is not a 32-byte hex key; it will be ignored.");
}
const DEPLOYER_PRIVATE_KEY = _keyIsValid ? (_trimmedKey.startsWith("0x") ? _trimmedKey : `0x${_trimmedKey}`) : null; // secret-scan:allow (reads from env; no literal key)

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: false,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    arcTestnet: {
      url: ARC_TESTNET_RPC,
      chainId: 5042002,
      // Only pass accounts if the key is actually set — prevents silent dummy-key deployment.
      ...(DEPLOYER_PRIVATE_KEY ? { accounts: [DEPLOYER_PRIVATE_KEY] } : {}),
    },
  },
  mocha: {
    timeout: 40000,
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
