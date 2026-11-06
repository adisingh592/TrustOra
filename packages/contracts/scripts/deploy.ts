import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { ARC_TESTNET_CONFIG } from "../src/lib/arc";
import {
  LOCAL_NETWORKS,
  PreflightError,
  formatNative,
  runPreflight,
  verifyDeployment,
  type ChainAccess,
  type EscrowReader,
} from "../src/lib/deployPreflight";

/**
 * Deploys TrustoraEscrow.
 *
 *   DEPLOY_DRY_RUN=1  -> run every preflight check (network, key, USDC, gas, balance) and STOP before sending anything.
 *
 * On a live network every check in src/lib/deployPreflight.ts must pass before the single deploy transaction
 * is sent, and the result is verified read-only afterwards. Any failure aborts with "Nothing was sent."
 * The private key is read by Hardhat from the environment and is never printed.
 */
const ESCROW_VIEW_ABI = [
  "function usdcToken() view returns (address)",
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
];

function escrowReader(): EscrowReader {
  const provider = ethers.provider;
  const at = (a: string) => new ethers.Contract(a, ESCROW_VIEW_ABI, provider);
  return {
    getChainId: async () => (await provider.getNetwork()).chainId,
    getCode: (a) => provider.getCode(a),
    usdcToken: (a) => at(a).usdcToken(),
    owner: (a) => at(a).owner(),
    paused: (a) => at(a).paused(),
  };
}

async function main() {
  const isLocal = LOCAL_NETWORKS.includes(network.name);
  const dryRun = ["1", "true"].includes((process.env.DEPLOY_DRY_RUN ?? "").toLowerCase());

  console.log("========================================");
  console.log(`TRUSTORA Escrow Deployment${dryRun ? " (DRY RUN: nothing will be sent)" : ""}`);
  console.log(`Network: ${network.name} (configured chain ID: ${network.config.chainId})`);
  console.log("========================================");

  const [deployer] = await ethers.getSigners();
  const Escrow = await ethers.getContractFactory("TrustoraEscrow");
  let usdcAddress: string;

  if (isLocal) {
    if (dryRun) {
      console.log("Local in-memory network: no preflight is needed and nothing persists. Dry run complete.");
      return;
    }
    console.log("Local network: deploying MockUSDC for testing...");
    const mock = await (await ethers.getContractFactory("MockUSDC")).deploy();
    await mock.waitForDeployment();
    usdcAddress = await mock.getAddress();
  } else {
    const provider = ethers.provider;
    const chain: ChainAccess = {
      getChainId: async () => (await provider.getNetwork()).chainId,
      getBalance: (a) => provider.getBalance(a),
      getCode: (a) => provider.getCode(a),
      getErc20Decimals: async (a) => Number(await new ethers.Contract(a, ["function decimals() view returns (uint8)"], provider).decimals()),
      estimateDeploy: async (usdc) => {
        const tx = await Escrow.getDeployTransaction(usdc);
        const gasLimit = await deployer!.estimateGas(tx);
        const fee = await provider.getFeeData();
        const maxFeePerGas = fee.maxFeePerGas ?? fee.gasPrice;
        if (!maxFeePerGas) throw new Error("no fee data");
        return { gasLimit, maxFeePerGas };
      },
    };

    const report = await runPreflight({ env: process.env, networkName: network.name, deployer: deployer?.address, chain });
    console.log("Preflight passed:");
    console.log(`  chain ID:          ${report.chainId}`);
    console.log(`  deployer:          ${report.deployer}`);
    console.log(`  USDC (ERC-20):     ${report.usdcAddress} (${report.usdcDecimals} decimals)`);
    console.log(`  balance:           ${formatNative(report.balance)} USDC (gas)`);
    console.log(`  estimated cost:    ${formatNative(report.estimatedCost)} USDC (needs >= ${formatNative(report.requiredBalance)} incl. margin)`);
    if (dryRun) {
      console.log("\nDRY RUN complete: every check passed and NOTHING was sent. Run again without DEPLOY_DRY_RUN to deploy.");
      return;
    }
    usdcAddress = report.usdcAddress;
  }

  console.log("Deploying TrustoraEscrow...");
  const escrow = await Escrow.deploy(usdcAddress);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  const txHash = escrow.deploymentTransaction()?.hash ?? null;

  console.log("----------------------------------------");
  console.log("TrustoraEscrow deployed");
  console.log(`  Contract:      ${escrowAddress}`);
  console.log(`  Deploy tx:     ${txHash}`);
  if (network.name === "arcTestnet") console.log(`  Explorer:      ${ARC_TESTNET_CONFIG.blockExplorers.default.url}/address/${escrowAddress}`);
  console.log("----------------------------------------");

  let verified = true;
  if (!isLocal) {
    try {
      await verifyDeployment({ reader: escrowReader(), escrow: escrowAddress, expectedUsdc: usdcAddress, expectedOwner: deployer!.address });
      console.log("Post-deploy verification passed (code present, wired to the expected USDC, owner is the deployer, not paused).");
    } catch (err) {
      verified = false;
      console.error(`POST-DEPLOY VERIFICATION FAILED: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`The contract exists at ${escrowAddress}. Do not use it until this is resolved.`);
    }
  }

  const dir = path.join(__dirname, "../deployments");
  fs.mkdirSync(dir, { recursive: true });
  const record = {
    network: network.name,
    chainId: Number(network.config.chainId),
    escrowContract: escrowAddress,
    usdcContract: usdcAddress,
    deployer: deployer?.address,
    deploymentTxHash: txHash,
    deployedAt: new Date().toISOString(),
    verified,
  };
  const file = path.join(dir, `${network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  console.log(`Saved deployment record: ${file}`);

  if (!isLocal) {
    console.log("\nNext steps:");
    console.log(`  1. Set ESCROW_CONTRACT_ADDRESS=${escrowAddress} in apps/web/.env, then restart the app.`);
    console.log(`  2. Confirm it: ESCROW_CONTRACT_ADDRESS=${escrowAddress} npm run check:deployment -w @trustora/contracts`);
  }
  if (!verified) process.exitCode = 1;
}

main().catch((error) => {
  if (error instanceof PreflightError) {
    console.error(`\nPreflight failed [${error.code}]: ${error.message}`);
  } else {
    console.error("\nDeployment failed:", error?.shortMessage ?? error?.message ?? String(error));
  }
  process.exitCode = 1;
});
