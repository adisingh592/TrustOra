import { ARC_TESTNET_CHAIN_ID } from "@trustora/shared";
import { AuthError, type WalletAuthService } from "@trustora/security";
import type { PrismaClient } from "@prisma/client";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from "fastify";
import { z } from "zod";
import type { AuthConfig } from "./config.js";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, type SessionCodec } from "./session.js";
import { upsertUserByWallet } from "./users.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by requireUser. */
    userId: string | null;
  }
}

const NonceBodySchema = z.object({
  address: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .transform((address) => address.toLowerCase())
    .optional(),
});

const VerifyBodySchema = z.object({
  message: z.string(),
  signature: z.string(),
});

const sendError = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

const statusOf = (error: unknown) =>
  typeof (error as { statusCode?: unknown }).statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : 500;

// Logs the error type and code only, so request data cannot reach the logs.
const sendInternalError = (request: FastifyRequest, reply: FastifyReply, error: unknown) => {
  const { name, code } = error as { name?: string; code?: string };
  request.log.error({ errorName: name, errorCode: code }, "auth request failed");
  return sendError(reply, 500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
};

export const createRequireUser =
  (sessions: SessionCodec): preHandlerAsyncHookHandler =>
  async (request, reply) => {
    const session = sessions.verify(request.cookies[SESSION_COOKIE]);
    if (!session) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Please sign in.");
    }
    request.userId = session.userId;
  };

export interface AuthRouteDeps {
  prisma: PrismaClient;
  verifier: WalletAuthService;
  sessions: SessionCodec;
  config: AuthConfig;
  requireUser: preHandlerAsyncHookHandler;
}

export const authRoutes = async (app: FastifyInstance, deps: AuthRouteDeps) => {
  const { prisma, verifier, sessions, config, requireUser } = deps;

  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
  } as const;

  app.setErrorHandler((error, request, reply) => {
    if (statusOf(error) < 500) {
      return sendError(reply, 400, "INVALID_INPUT", "The request is not valid.");
    }
    return sendInternalError(request, reply, error);
  });

  app.post("/auth/nonce", async (request, reply) => {
    const body = NonceBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendError(reply, 400, "INVALID_INPUT", "The wallet address is not valid.");
    }
    return verifier.createNonce({
      domain: config.domain,
      chainId: ARC_TESTNET_CHAIN_ID,
      ...(body.data.address ? { address: body.data.address } : {}),
    });
  });

  app.post(
    "/auth/verify-wallet",
    {
      // A failed sign-in is always a 401, including a body that cannot be parsed.
      errorHandler: (error, request, reply) => {
        if (error instanceof AuthError) {
          return sendError(reply, 401, error.code, error.message);
        }
        if (statusOf(error) < 500) {
          return sendError(reply, 401, "MALFORMED_MESSAGE", "The sign-in request is not valid.");
        }
        return sendInternalError(request, reply, error);
      },
    },
    async (request, reply) => {
      const body = VerifyBodySchema.safeParse(request.body ?? {});
      if (!body.success) {
        const onlySignature = body.error.issues.every((issue) => issue.path[0] === "signature");
        throw onlySignature
          ? new AuthError("MALFORMED_SIGNATURE", "The signature is not valid.")
          : new AuthError("MALFORMED_MESSAGE", "The sign-in message is not valid.");
      }
      const { address } = await verifier.verify(body.data.message, body.data.signature);
      const user = await upsertUserByWallet(prisma, address);
      reply.setCookie(SESSION_COOKIE, sessions.sign(user.id), {
        ...cookieOptions,
        maxAge: SESSION_TTL_SECONDS,
      });
      return { address: user.walletAddress, userId: user.id };
    },
  );

  app.post("/auth/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return { ok: true };
  });

  app.get("/auth/me", { preHandler: requireUser }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId ?? "" } });
    if (!user) return sendError(reply, 401, "UNAUTHENTICATED", "Please sign in.");
    return { address: user.walletAddress, userId: user.id };
  });
};
