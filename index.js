'use strict';

/**
 * Module dependencies.
 */
const debug = require('debug')('koa-simple-ratelimit');
const ms = require('ms');

function find(db, p) {
  return new Promise((resolve, reject) => {
    db.get(p, (err, reply) => {
      if (err) {
        reject(err);
      }
      resolve(reply);
    });
  });
}

function pttl(db, p) {
  return new Promise((resolve, reject) => {
    db.pttl(p, (err, reply) => {
      if (err) {
        reject(err);
      }
      resolve(reply);
    });
  });
}

/**
 * Initialize ratelimit middleware with the given `opts`:
 *
 * - `duration` limit duration in milliseconds [1 hour]
 * - `max` max requests per `id` [2500]
 * - `db` database connection
 * - `id` id to compare requests [ip]
 * - `headers` custom header names
 *  - `remaining` remaining number of requests ['X-RateLimit-Remaining']
 *  - `reset` reset timestamp ['X-RateLimit-Reset']
 *  - `total` total number of requests ['X-RateLimit-Limit']
 *
 * @param {Object} opts
 * @return {Function}
 * @api public
 */

function ratelimit(opts) {
  opts = opts || {};
  opts.headers = opts.headers || {};
  opts.headers.remaining = opts.headers.remaining || 'X-RateLimit-Remaining';
  opts.headers.reset = opts.headers.reset || 'X-RateLimit-Reset';
  opts.headers.total = opts.headers.total || 'X-RateLimit-Limit';

  return async function ratelimiter(ctx, next) {
    const id = opts.id ? opts.id(ctx) : ctx.ip;

    if (id === false) {
      return next();
    }

    // whitelist
    if (opts.whitelist && opts.whitelist.indexOf(id) !== -1) {
      return next();
    }
    // blacklist
    if (opts.blacklist && opts.blacklist.indexOf(id) !== -1) {
      return ctx.throw(403);
    }

    const name = `limit:${id}:count`;
    const cur = await find(opts.db, name);
    const n = Math.floor(cur);
    let t = Date.now();
    t += opts.duration || 3600000;
    t = new Date(t).getTime() / 1000 || 0;

    const headers = {};
    headers[opts.headers.remaining] = opts.max - 1;
    headers[opts.headers.reset] = t;
    headers[opts.headers.total] = opts.max;
    ctx.set(headers);

    // not existing in redis
    if (cur === null) {
      debug('remaining %s/%s %s', opts.max - 1, opts.max, id);
      opts.db.set(name, opts.max - 1, 'PX', opts.duration || 3600000, 'NX');
      return next();
    }

    const expires = await pttl(opts.db, name);
    if (n - 1 >= 0) {
      // existing in redis
      opts.db.decr(name);
      debug('remaining %s/%s %s', n - 1, opts.max, id);
      headers[opts.headers.remaining] = n - 1;
      ctx.set(headers);
      return next();
    }
    if (expires < 0) {
      debug(`${name} is stuck. Resetting.`);
      debug('remaining %s/%s %s', opts.max - 1, opts.max, id);
      opts.db.set(name, opts.max - 1, 'PX', opts.duration || 3600000, 'NX');
      return next();
    }
    // user maxed
    headers['Retry-After'] = t;
    headers[opts.headers.remaining] = n;
    ctx.set(headers);
    ctx.status = 429;
    const retryTime = ms(expires, { long: true });
    ctx.body = `Rate limit exceeded, retry in ${retryTime}`;
    if (opts.throw) {
      ctx.throw(ctx.status, ctx.body, { headers: headers });
    }
  };
}

/**
 * Expose `ratelimit()`.
 */
module.exports = ratelimit;
