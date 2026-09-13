import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import Google from "@auth/core/providers/google";
import { createAuthUser, googleConfigured, googleProfile, playerRedirect } from "./auth_policy";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password({
    profile(params) {
      const login = process.env.OWNER_LOGIN?.trim().toLowerCase();
      if (!login || params.flow !== "signIn" || typeof params.email !== "string" ||
          params.email.trim().toLowerCase() !== login) {
        throw new Error("Aanmelden niet toegestaan.");
      }
      return { email: login, name: "Jelle" };
    },
  }), ...(googleConfigured() ? [Google({
    profile: googleProfile,
    checks: ["pkce", "state", "nonce"],
    authorization: { params: { scope: "openid profile email", prompt: "select_account" } },
  })] : [])],
  callbacks: {
    async redirect({ redirectTo }) { return playerRedirect(redirectTo); },
    createOrUpdateUser: createAuthUser,
  },
});
