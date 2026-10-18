import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import { relayAuth } from "./auth_proxy";

const http = httpRouter();
const relaySite = process.env.AUTH_PROXY_URL;
if (relaySite) {
  const relay = httpAction(async (_ctx, request) => relayAuth(request, relaySite));
  http.route({ pathPrefix: "/api/auth/signin/", method: "GET", handler: relay });
  http.route({ pathPrefix: "/api/auth/callback/", method: "GET", handler: relay });
  http.route({ pathPrefix: "/api/auth/callback/", method: "POST", handler: relay });
  http.route({ path: "/.well-known/openid-configuration", method: "GET", handler: relay });
  http.route({ path: "/.well-known/jwks.json", method: "GET", handler: relay });
} else {
  auth.addHttpRoutes(http);
}
export default http;
