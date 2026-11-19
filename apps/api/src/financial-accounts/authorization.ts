import { z } from "zod";

type OwnerAuthOptions = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  ownerUserId: string;
  ownerGoogleSubject: string;
};

type OwnerAuthorization =
  | { status: "authorized"; ownerUserId: string }
  | { status: "unauthenticated" | "forbidden" | "unavailable" };

const userSchema = z.object({
  id: z.uuid(),
  identities: z.array(z.object({ provider: z.string(), provider_id: z.string() })).default([]),
});

const oauthClaims = z.object({
  sub: z.uuid(),
  role: z.literal("authenticated"),
  aud: z.literal("authenticated"),
  client_id: z.never().optional(),
  amr: z.array(z.object({ method: z.string() })),
});

function hasOAuthSession(payload: string, userId: string) {
  try {
    const parsed = oauthClaims.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return parsed.success
      && parsed.data.sub === userId
      && parsed.data.amr.some(({ method }) => method === "oauth");
  } catch {
    return false;
  }
}

export function createOwnerAuthorizer(options: OwnerAuthOptions, lookupUser = fetch) {
  const userEndpoint = new URL("/auth/v1/user", options.supabaseUrl);

  return async (authorization?: string): Promise<OwnerAuthorization> => {
    const token = /^Bearer ([\w-]+\.([\w-]+)\.[\w-]+)$/i.exec(authorization ?? "");
    if (!token) {
      return { status: "unauthenticated" };
    }

    try {
      // Supabase verifies this exact JWT before we use its claims.
      const response = await lookupUser(userEndpoint, {
        headers: {
          apikey: options.supabasePublishableKey,
          Authorization: `Bearer ${token[1]}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      if ([400, 401, 403, 404].includes(response.status)) {
        return { status: "unauthenticated" };
      }
      if (!response.ok) {
        return { status: "unavailable" };
      }

      const user = userSchema.parse(await response.json());
      const [identity] = user.identities;
      if (
        user.id !== options.ownerUserId
        || user.identities.length !== 1
        || identity.provider !== "google"
        || identity.provider_id !== options.ownerGoogleSubject
        || !hasOAuthSession(token[2], user.id)
      ) {
        return { status: "forbidden" };
      }
      return { status: "authorized", ownerUserId: user.id };
    } catch {
      return { status: "unavailable" };
    }
  };
}

export type AuthorizeOwner = ReturnType<typeof createOwnerAuthorizer>;
