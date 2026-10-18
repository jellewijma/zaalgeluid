import http from 'node:http';

// Convex supports sharing an origin with HTTP actions beneath /http.
// Keep both native listeners private and let Tailscale supply public TLS.
function destination(url = '/') {
  const isAction = url === '/http' || url.startsWith('/http/') || url.startsWith('/http?');
  const stripped = isAction ? url.slice(5) : url;
  return {
    hostname: '127.0.0.1',
    port: isAction ? 3211 : 3210,
    path: stripped.startsWith('/') ? stripped : `/${stripped}`,
  };
}

const server = http.createServer((incoming, response) => {
  const upstream = http.request({
    ...destination(incoming.url),
    method: incoming.method,
    headers: { ...incoming.headers, 'x-forwarded-proto': 'https' },
  }, (received) => {
    response.writeHead(received.statusCode ?? 502, received.headers);
    received.pipe(response);
    received.on('error', () => response.destroy());
  });
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
    response.end('Backend unavailable');
  });
  incoming.on('aborted', () => upstream.destroy());
  incoming.pipe(upstream);
});

server.on('upgrade', (incoming, socket, head) => {
  const upstream = http.request({
    ...destination(incoming.url),
    method: incoming.method,
    headers: { ...incoming.headers, 'x-forwarded-proto': 'https' },
  });
  upstream.on('upgrade', (received, upstreamSocket, upstreamHead) => {
    socket.write(`HTTP/1.1 ${received.statusCode} ${received.statusMessage}\r\n`);
    for (let index = 0; index < received.rawHeaders.length; index += 2) {
      socket.write(`${received.rawHeaders[index]}: ${received.rawHeaders[index + 1]}\r\n`);
    }
    socket.write('\r\n');
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    socket.pipe(upstreamSocket).pipe(socket);
    socket.on('error', () => upstreamSocket.destroy());
    upstreamSocket.on('error', () => socket.destroy());
  });
  upstream.on('response', (received) => {
    socket.end(`HTTP/1.1 ${received.statusCode} ${received.statusMessage}\r\nConnection: close\r\n\r\n`);
    received.resume();
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  upstream.end();
});

server.listen(3212, '127.0.0.1');
