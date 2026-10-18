import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { relayAuth } from "../convex/auth_proxy";

const siteUrl = "https://appa.example:10000/http";
const modules = import.meta.glob("../convex/**/*.ts");

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("AUTH_PROXY_URL", siteUrl);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("OAuth relay", () => {
  it("preserves redirects and separate OAuth cookies without following the redirect", async () => {
    const cookies = [
      "__Host-googleOAuthpkce=pkce-value; Path=/; HttpOnly; Secure; SameSite=Lax",
      "__Host-googleOAuthstate=state-value; Path=/; HttpOnly; Secure; SameSite=Lax",
      "__Host-googleOAuthnonce=nonce-value; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; Secure; SameSite=Lax",
    ];
    const headers = new Headers({ location: "https://accounts.google.com/o/oauth2/auth?state=state-value" });
    for (const cookie of cookies) headers.append("set-cookie", cookie);
    const upstreamResponse = new Response(null, { status: 302, headers });
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(upstreamResponse);
    vi.stubGlobal("fetch", fetchStub);

    const response = await relayAuth(new Request("https://old.convex.site/api/auth/signin/google?code=verifier"), siteUrl);

    expect(response).toBe(upstreamResponse);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://accounts.google.com/o/oauth2/auth?state=state-value");
    expect(response.headers.getSetCookie()).toEqual(cookies);
    expect(fetchStub).toHaveBeenCalledOnce();
    expect(fetchStub.mock.calls[0][1]?.redirect).toBe("manual");
  });

  it("keeps encoded callback parameters and incoming cookies while replacing the origin", async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchStub);
    const query = "?code=a%2Fb%2Bc&state=a+b&scope=openid%20email&scope=profile";
    const request = new Request("https://old.convex.site/api/auth/callback/google" + query, {
      headers: {
        host: "old.convex.site",
        cookie: "__Host-googleOAuthstate=state; __Host-googleOAuthpkce=pkce",
        "content-length": "0",
      },
    });

    await relayAuth(request, siteUrl + "/");

    const [destination, options] = fetchStub.mock.calls[0];
    expect(String(destination)).toBe(siteUrl + "/api/auth/callback/google" + query);
    const headers = new Headers(options?.headers);
    expect(headers.get("cookie")).toBe(request.headers.get("cookie"));
    expect(headers.has("host")).toBe(false);
    expect(headers.has("content-length")).toBe(false);
    expect(options?.body).toBeUndefined();
  });

  it("forwards POST callbacks as the original body bytes and content type", async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(new Response("callback"));
    vi.stubGlobal("fetch", fetchStub);
    const body = "code=a%2Fb&state=state%2Bvalue&user=%7B%22name%22%3A%22Jelle%22%7D";
    const request = new Request("https://old.convex.site/api/auth/callback/google?provider=google", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: "__Host-googleOAuthstate=state" },
      body,
    });

    await relayAuth(request, siteUrl);

    const [destination, options] = fetchStub.mock.calls[0];
    expect(String(destination)).toBe(siteUrl + "/api/auth/callback/google?provider=google");
    expect(options?.method).toBe("POST");
    expect(new TextDecoder().decode(options?.body as ArrayBuffer)).toBe(body);
    expect(new Headers(options?.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(new Headers(options?.headers).get("cookie")).toBe("__Host-googleOAuthstate=state");
  });

  it.each([
    "http://appa.example/http",
    "https://user:secret@appa.example/http",
    "https://appa.example/http?override=true",
    "https://appa.example/http#fragment",
  ])("rejects unsafe relay configuration %s before making a request", async (destination) => {
    const fetchStub = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchStub);
    await expect(relayAuth(new Request("https://old.convex.site/api/auth/callback/google"), destination))
      .rejects.toThrow("Invalid authentication relay configuration");
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe("relay deployment boundaries", () => {
  it("exposes only OAuth callbacks, sign-in and discovery routes", async () => {
    const { default: http } = await import("../convex/http");
    for (const [path, method] of [
      ["/api/auth/signin/google", "GET"],
      ["/api/auth/callback/google", "GET"],
      ["/api/auth/callback/google", "POST"],
      ["/.well-known/openid-configuration", "GET"],
      ["/.well-known/jwks.json", "GET"],
    ] as const) {
      expect(http.lookup(path, method), `${method} ${path}`).not.toBeNull();
    }
    for (const [path, method] of [
      ["/api/query", "POST"],
      ["/api/mutation", "POST"],
      ["/api/auth/signin/google", "POST"],
      ["/api/auth/signout", "GET"],
      ["/.well-known/jwks.json/extra", "GET"],
      ["/.well-known/jwks.json", "POST"],
      ["/api/auth/callback-elsewhere/google", "GET"],
    ] as const) {
      expect(http.lookup(path, method), `${method} ${path}`).toBeNull();
    }
  });

  it("disables cleanup schedules on the relay and retains them on the new backend", async () => {
    expect((await import("../convex/crons")).default.crons).toEqual({});
    vi.stubEnv("AUTH_PROXY_URL", "");
    vi.resetModules();
    const backendCrons = (await import("../convex/crons")).default.crons;
    expect(Object.values(backendCrons).map((job) => job.name).sort())
      .toEqual(["cleanup:expired", "cleanup:orphanedUploads"]);
  });

  it("uses the /http issuer and JWKS location consistently on the new backend", async () => {
    vi.stubEnv("AUTH_PROXY_URL", "");
    vi.stubEnv("CONVEX_SITE_URL", siteUrl);
    vi.stubEnv("JWKS", '{"keys":[]}');
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("Unexpected network request")));
    const backend = convexTest({ schema, modules });

    const response = await backend.fetch("/.well-known/openid-configuration");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      issuer: siteUrl,
      jwks_uri: siteUrl + "/.well-known/jwks.json",
    });
    const { default: authConfig } = await import("../convex/auth.config");
    expect(authConfig.providers[0].domain).toBe(siteUrl);
  });
});
