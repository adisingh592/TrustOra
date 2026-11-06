import Fastify from "fastify";

export const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

app.get("/health", async () => ({ ok: true }));

if (process.env.NODE_ENV !== "test") {
  try {
    await app.listen({ port: Number(process.env.PORT) || 3001 });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
