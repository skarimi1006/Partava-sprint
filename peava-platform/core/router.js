'use strict';

// ---------------------------------------------------------------------------
// Lightweight HTTP router — no Express.
// Supports static path segments and :param captures.
// All handlers receive (req, res, params, db) and must end the response.
// ---------------------------------------------------------------------------

const routes = {};  // { METHOD: [ { pattern, keys, handler } ] }

function register(method, path, handler) {
  if (!routes[method]) routes[method] = [];
  const keys    = [];
  const pattern = new RegExp(
    '^' + path.replace(/:([^/]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'
  );
  routes[method].push({ pattern, keys, handler });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

async function dispatch(req, res, db) {
  const method = req.method.toUpperCase();
  const url    = new URL(req.url, 'http://localhost');
  const path   = url.pathname;

  // Attach query helpers
  req.query = Object.fromEntries(url.searchParams);

  // Parse JSON body for mutating methods
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    req.body = await new Promise((resolve) => {
      let data = '';
      req.on('data', c => { data += c; });
      req.on('end',  () => {
        try { resolve(JSON.parse(data || '{}')); }
        catch { resolve({}); }
      });
    });
  } else {
    req.body = {};
  }

  const list = routes[method] || [];
  for (const { pattern, keys, handler } of list) {
    const m = path.match(pattern);
    if (m) {
      const params = {};
      keys.forEach((k, i) => { params[k] = m[i + 1]; });
      try {
        await handler(req, res, params, db);
      } catch (err) {
        console.error(`[router] ${method} ${path}:`, err);
        if (!res.headersSent) send(res, 500, { ok: false, error: 'Server error' });
      }
      return;
    }
  }

  // No route matched
  send(res, 404, { ok: false, error: 'Not found' });
}

// Convenience wrappers
const get    = (p, h) => register('GET',    p, h);
const post   = (p, h) => register('POST',   p, h);
const put    = (p, h) => register('PUT',    p, h);
const del    = (p, h) => register('DELETE', p, h);

module.exports = { register, dispatch, send, get, post, put, del };
