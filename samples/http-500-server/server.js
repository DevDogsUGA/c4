// Protocol-fault stress sample: a minimal custom server (allowPlumbing:true)
// whose /health is fine but whose /move always answers 500.
const http = require('node:http');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Private-Network': 'true',
};

function send(res, status, body) {
  const payload = body === undefined ? '' : body;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...CORS_HEADERS });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 200, '');
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, 'ok');
  if (req.method === 'POST' && req.url === '/move') {
    req.on('data', () => {});
    req.on('end', () => send(res, 500, JSON.stringify({ error: 'simulated server error' })));
    return;
  }
  send(res, 404, '');
});

server.listen(process.env.PORT || 8000);
