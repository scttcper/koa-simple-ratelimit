
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
 * Expose `ratelimit()`.
 */

module.exports = ratelimit;

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
function ratelimit(opts = {}) {
  const {
    remaining = 'X-RateLimit-Remaining',
    reset = 'X-RateLimit-Reset',
    total = 'X-RateLimit-Limit',
  } = opts.headers || {};

  return async function(ctx, next) {
    const id = opts.id ? opts.id(ctx) : ctx.ip;

    if (id === false) {
      return next();
    }

    // Whitelist
    if (opts.whitelist && opts.whitelist.indexOf(id) !== -1) {
      return next();
    }
    // Blacklist
    if (opts.blacklist && opts.blacklist.indexOf(id) !== -1) {
      return ctx.throw(403);
    }

    const prefix = opts.prefix ? opts.prefix : 'limit';
    const name = `${prefix}:${id}:count`;
    const cur = await find(opts.db, name);
    const n = Math.floor(cur);
    let t = Date.now();
    t += opts.duration || 3600000;
    t = new Date(t).getTime() / 1000 || 0;

    const headers = {
      [remaining]: opts.max - 1,
      [reset]: t,
      [total]: opts.max,
    };
    ctx.set(headers);

    // Not existing in redis
    if (cur === null) {
      opts.db.set(name, opts.max - 1, 'PX', opts.duration || 3600000, 'NX');
      debug('remaining %s/%s %s', opts.max - 1, opts.max, id);
      return next();
    }

    const expires = await pttl(opts.db, name);
    if (n - 1 >= 0) {
      // Existing in redis
      opts.db.decr(name);
      ctx.set(remaining, n - 1);
      debug('remaining %s/%s %s', n - 1, opts.max, id);
      return next();
    }
    if (expires < 0) {
      debug(`${name} is stuck. Resetting.`);
      opts.db.set(name, opts.max - 1, 'PX', opts.duration || 3600000, 'NX');
      return next();
    }
    // User maxed
    debug('remaining %s/%s %s', remaining, opts.max, id);
    ctx.set(remaining, n);
    ctx.set('Retry-After', t);
    ctx.status = 429;
    ctx.body = opts.errorMessage || `Rate limit exceeded, retry in ${ms(expires, { long: true })}.`;
    if (opts.throw) {
      ctx.throw(ctx.status, ctx.body, { headers });
    }
  };
}
