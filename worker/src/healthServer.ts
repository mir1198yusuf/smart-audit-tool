import http from 'node:http';

const DEFAULT_PORT = 3001;

// Tiny HTTP server with a single /test endpoint — some free-tier hosting providers stop/sleep
// processes after a period of no inbound HTTP traffic; since this worker is a background polling
// process with no HTTP traffic of its own, an external uptime pinger hitting this endpoint keeps
// it classified as active.
export function startHealthServer(): void {
  const port = Number(process.env.PORT) || DEFAULT_PORT;

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/test') {
      console.log(`[worker] /test endpoint hit at ${new Date().toISOString()}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(port, () => {
    console.log(`[worker] health server listening on port ${port} (GET /test)`);
  });
}
