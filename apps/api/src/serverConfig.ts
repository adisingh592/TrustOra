import { WalletAddressSchema } from "@trustora/shared";
import { z } from "zod";

/**
 * Checked only when NODE_ENV=production. Never put a value in the message: zod's
 * built-in issue text names the field and the rule, never what was given.
 * UPLOAD_DIR is deliberately not checked here: no upload feature exists yet, so
 * there is nothing to validate it against. Add it once one does.
 */
const ProductionEnvSchema = z.object({
  SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),
  AUTH_DOMAIN: z.string().min(1, "is required"),
  DATABASE_URL: z.string().min(1, "is required"),
  WEB_ORIGIN: z.string().min(1, "is required"),
  ARC_TESTNET_USDC_ADDRESS: WalletAddressSchema,
});

/** Throws a single, secret-free, multi-line message naming every problem found. */
export const validateProductionEnv = (env: NodeJS.ProcessEnv = process.env): void => {
  if (env.NODE_ENV !== "production") return;
  const result = ProductionEnvSchema.safeParse(env);
  if (result.success) return;
  const problems = result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`);
  throw new Error(`Refusing to start in production:\n- ${problems.join("\n- ")}`);
};
