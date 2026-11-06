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

export const StartupConfigSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    PORT: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .optional()
      .default("3001"),
    SESSION_SECRET: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    AUTH_DOMAIN: z.string().optional(),
    CORS_ORIGIN: z.string().optional(),
    WEB_ORIGIN: z.string().optional(),
    CHAIN_ADAPTER: z.enum(["mock", "arc"]).optional().default("mock"),
    EVALUATION_ADAPTER: z.enum(["heuristic", "zerog"]).optional().default("heuristic"),
    ARC_TESTNET_CHAIN_ID: z.string().optional(),
    ARC_TESTNET_RPC_URL: z.string().optional(),
    ARC_TESTNET_USDC_ADDRESS: z.string().optional(),
    ARC_ESCROW_CONTRACT_ADDRESS: z.string().optional(),
    ZG_RPC_URL: z.string().optional(),
    ZG_STORAGE_CONTRACT: z.string().optional(),
    ZG_MODEL_ID: z.string().optional(),
    STORAGE_DIR: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.CHAIN_ADAPTER === "arc") {
      if (!data.ARC_ESCROW_CONTRACT_ADDRESS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ARC_ESCROW_CONTRACT_ADDRESS"],
          message: "is required when CHAIN_ADAPTER=arc",
        });
      }
      if (!data.ARC_TESTNET_RPC_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ARC_TESTNET_RPC_URL"],
          message: "is required when CHAIN_ADAPTER=arc",
        });
      }
      if (data.ARC_TESTNET_CHAIN_ID !== "5042002") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ARC_TESTNET_CHAIN_ID"],
          message: "must be 5042002 when CHAIN_ADAPTER=arc",
        });
      }
    }

    if (data.EVALUATION_ADAPTER === "zerog") {
      if (!data.ZG_RPC_URL && !data.ZG_STORAGE_CONTRACT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ZG_RPC_URL"],
          message: "is required when EVALUATION_ADAPTER=zerog",
        });
      }
    }
  });

export const validateStartupConfig = (env: NodeJS.ProcessEnv = process.env) => {
  const result = StartupConfigSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`);
    throw new Error(`Startup config validation failed:\n- ${problems.join("\n- ")}`);
  }
  return result.data;
};

/** Throws a single, secret-free, multi-line message naming every problem found. */
export const validateProductionEnv = (env: NodeJS.ProcessEnv = process.env): void => {
  if (env.NODE_ENV !== "production") return;
  const result = ProductionEnvSchema.safeParse(env);
  if (result.success) return;
  const problems = result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`);
  throw new Error(`Refusing to start in production:\n- ${problems.join("\n- ")}`);
};
