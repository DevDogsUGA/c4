// Protocol-fault stress sample: /move answers 200 but with a huge junk body
// instead of a valid {"column": n} response.
const http = require('node:http');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Private-Network': 'true',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers, ...CORS_HEADERS });
  res.end(body);
}

const JUNK = 'x'.repeat(8 * 1024 * 1024); // 8MB of padding

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 200, '');
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, 'ok');
  if (req.method === 'POST' && req.url === '/move') {
    req.on('data', () => {});
    // No "column" field at all -- fails MoveResponseSchema -> invalid_move.
    req.on('end', () => send(res, 200, JSON.stringify({ junk: JUNK })));
    return;
  }
  send(res, 404, '');
});

server.listen(process.env.PORT || 8000);
