// Protocol-fault stress sample: /health is fine, /move starts a response
// (status + headers) and then trickles the body one byte at a time on a
// slow interval, so the response is never "fully received" before the
// chess clock (wall-clock, request-sent -> response-fully-received) drains.
const http = require('node:http');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Private-Network': 'true',
};

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    return res.end();
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, CORS_HEADERS);
    return res.end('ok');
  }
  if (req.method === 'POST' && req.url === '/move') {
    req.on('data', () => {});
    req.on('end', () => {
      const body = JSON.stringify({ column: 0 });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(body.length), ...CORS_HEADERS });
      let i = 0;
      const trickle = setInterval(() => {
        if (i >= body.length) {
          clearInterval(trickle);
          return res.end();
        }
        res.write(body[i]);
        i++;
      }, 1000);
    });
    return;
  }
  res.writeHead(404, CORS_HEADERS);
  res.end();
});

server.listen(process.env.PORT || 8000);
