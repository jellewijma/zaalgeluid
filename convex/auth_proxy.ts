// Keep the Google callback that is already registered while the backend runs on Appa.
export async function relayAuth(request: Request, siteUrl: string): Promise<Response> {
  const source = new URL(request.url);
  const destination = new URL(siteUrl);
  if (destination.protocol !== "https:" || destination.username || destination.password ||
      destination.search || destination.hash) {
    throw new Error("Invalid authentication relay configuration");
  }
  destination.pathname = destination.pathname.replace(/\/$/, "") + source.pathname;
  destination.search = source.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  return fetch(destination, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
    redirect: "manual",
  });
}
