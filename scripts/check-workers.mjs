#!/usr/bin/env node
// Post-deploy checks for testground and practice-bots Cloudflare Workers.
// Validates that the apps are running and responding correctly to expected requests.

import { URL } from 'url';

const TESTGROUND_URL = process.env.TESTGROUND_URL || 'http://localhost:8787';
const PRACTICE_BOTS_URL = process.env.PRACTICE_BOTS_URL || 'http://localhost:8787';

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
};

function pass(msg) {
  return `${colors.green}✓${colors.reset} ${msg}`;
}

function fail(msg) {
  return `${colors.red}✗${colors.reset} ${msg}`;
}

function info(msg) {
  return `${colors.yellow}→${colors.reset} ${msg}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

const results = [];

function recordResult(name, success, details = '') {
  results.push({ name, success, details });
  const symbol = success ? pass('PASS') : fail('FAIL');
  const msg = details ? ` — ${details}` : '';
  console.log(`${symbol} ${name}${msg}`);
}

async function checkTestgroundRoot() {
  try {
    console.log(info('Checking testground root...'));
    const response = await fetchWithTimeout(TESTGROUND_URL);

    if (response.status !== 200) {
      recordResult('Testground root status', false, `Got ${response.status}, expected 200`);
      return;
    }

    const html = await response.text();
    if (!html.includes('id="root"')) {
      recordResult('Testground root element', false, 'HTML does not contain id="root"');
      return;
    }

    recordResult('Testground root', true, `${response.status} with id="root"`);
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Timeout' : err.message;
    recordResult('Testground root', false, msg);
  }
}

async function checkPracticeBots() {
  try {
    console.log(info('Checking practice-bots health...'));
    const response = await fetchWithTimeout(`${PRACTICE_BOTS_URL}/health`);

    if (response.status !== 200) {
      recordResult('Practice-bots health', false, `Got ${response.status}, expected 200`);
      return;
    }

    const corsOrigin = response.headers.get('Access-Control-Allow-Origin');
    if (!corsOrigin) {
      recordResult('Practice-bots health CORS', false, 'Missing Access-Control-Allow-Origin header');
      return;
    }

    recordResult('Practice-bots health', true, `${response.status} with CORS`);
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Timeout' : err.message;
    recordResult('Practice-bots health', false, msg);
  }
}

async function checkBotMoveEndpoint(botName) {
  try {
    console.log(info(`Checking practice-bot ${botName}/move...`));

    // Construct a valid MoveRequest according to @acm-uga/c4-contract
    const moveRequest = {
      you: 1,
      board: Array(8).fill(null).map(() => Array(8).fill(0)),
      moves: [],
      game: {
        match_id: 'check-workers',
        game_number: 1,
        clock_remaining_ms: 5000,
      },
    };

    const url = `${PRACTICE_BOTS_URL}/${botName}/move`;
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(moveRequest),
    });

    if (response.status !== 200) {
      recordResult(`${botName}/move status`, false, `Got ${response.status}, expected 200`);
      return;
    }

    const body = await response.json();
    if (typeof body.column !== 'number' || body.column < 0 || body.column > 7) {
      recordResult(`${botName}/move response`, false, `Invalid column: ${body.column}`);
      return;
    }

    const corsOrigin = response.headers.get('Access-Control-Allow-Origin');
    if (!corsOrigin) {
      recordResult(`${botName}/move CORS`, false, 'Missing Access-Control-Allow-Origin header');
      return;
    }

    recordResult(`${botName}/move`, true, `Column ${body.column} with CORS`);
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Timeout' : err.message;
    recordResult(`${botName}/move`, false, msg);
  }
}

async function checkPreflight(botName) {
  try {
    console.log(info(`Checking OPTIONS preflight for ${botName}/move...`));

    const url = `${PRACTICE_BOTS_URL}/${botName}/move`;
    const response = await fetchWithTimeout(url, {
      method: 'OPTIONS',
    });

    // OPTIONS preflight may return 200 or 204
    if (response.status !== 200 && response.status !== 204) {
      recordResult(`${botName} preflight status`, false, `Got ${response.status}, expected 200 or 204`);
      return;
    }

    const corsOrigin = response.headers.get('Access-Control-Allow-Origin');
    if (!corsOrigin) {
      recordResult(`${botName} preflight CORS`, false, 'Missing Access-Control-Allow-Origin header');
      return;
    }

    // Check for Private Network Access header if it might be used
    const pnaHeader = response.headers.get('Access-Control-Allow-Private-Network');
    const pnaNote = pnaHeader ? 'with PNA' : 'without PNA';

    recordResult(`${botName} preflight`, true, `${response.status} ${pnaNote}`);
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Timeout' : err.message;
    recordResult(`${botName} preflight`, false, msg);
  }
}

async function runAllChecks() {
  console.log('');
  console.log('═'.repeat(60));
  console.log('Post-Deploy Worker Checks');
  console.log('═'.repeat(60));
  console.log('');

  console.log(`Testground URL: ${TESTGROUND_URL}`);
  console.log(`Practice-bots URL: ${PRACTICE_BOTS_URL}`);
  console.log('');

  await checkTestgroundRoot();
  console.log('');

  await checkPracticeBots();
  console.log('');

  const bots = ['random', 'greedy', 'minimax'];
  for (const bot of bots) {
    await checkBotMoveEndpoint(bot);
  }
  console.log('');

  for (const bot of bots) {
    await checkPreflight(bot);
  }
  console.log('');

  // Print summary
  console.log('═'.repeat(60));
  const totalPassed = results.filter((r) => r.success).length;
  const totalFailed = results.filter((r) => !r.success).length;
  console.log(
    `Results: ${totalPassed}/${results.length} passed${
      totalFailed > 0 ? `, ${totalFailed} failed` : ''
    }`
  );
  console.log('═'.repeat(60));
  console.log('');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runAllChecks().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
