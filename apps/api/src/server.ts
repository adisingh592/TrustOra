import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";

const isTest = process.env.NODE_ENV === "test";

// Values already set in the environment win over the file.
const envFile = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (!isTest && existsSync(envFile)) process.loadEnvFile(envFile);

const createApp = () => {
  try {
    return buildApp();
  } catch (err) {
    console.error(err instanceof Error ? err.message : "Could not start the API.");
    process.exit(1);
  }
};

export const app = createApp();

if (!isTest) {
  try {
    await app.listen({ port: Number(process.env.PORT) || 3001 });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
