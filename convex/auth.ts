import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

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
  })],
});
