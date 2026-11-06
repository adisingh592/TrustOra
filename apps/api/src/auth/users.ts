import type { PrismaClient, User } from "@prisma/client";

const WALLET_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * The only place that writes User.walletAddress, so every stored address is
 * lowercase and one wallet can never hold two accounts.
 */
export const upsertUserByWallet = (prisma: PrismaClient, address: string): Promise<User> => {
  if (!WALLET_ADDRESS.test(address)) throw new Error("Not a wallet address.");
  const walletAddress = address.toLowerCase();
  return prisma.user.upsert({
    where: { walletAddress },
    create: { walletAddress },
    update: {},
  });
};
