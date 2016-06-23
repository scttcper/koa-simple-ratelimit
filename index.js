'use strict';

/**
 * Module dependencies.
 */
const ms = require('ms');

function find(db, p) {
  return new Promise((resolve) => {
    db.get(p, (err, reply) => {
      resolve(reply);
    });
  });
}

function pttl(db, p) {
  return new Promise((resolve) => {
    db.pttl(p, (err, reply) => {
      resolve(reply);
    });
  });
}

function finish(ctx, next, max, n, t) {
  ctx.set('X-RateLimit-Limit', max);
  ctx.set('X-RateLimit-Remaining', n);
  ctx.set('X-RateLimit-Reset', t);
  return next();
}

/**
 * Initialize a new limiter with `opts`:
 *
 *  - `id` identifier being limited
 *  - `db` redis connection instance
 *
 * @param {Object} opts
 * @api public
 */

function ratelimit(opts) {
  opts = opts || {};

  return function ratelimiter(ctx, next) {
    const id = opts.id ? opts.id(ctx) : ctx.ip;
    if (id === false) return next();
    const name = `limit:${id}:count`;
    return find(opts.db, name).then((cur) => {
      let n = ~~cur;
      const ex = opts.duration || 3600000;
      let t = Date.now();
      t += ex;
      t = new Date(t).getTime() / 1000 | 0;
      if (cur !== null) {
        return pttl(opts.db, name).then((expires) => {
          if (n - 1 >= 0) {
            // existing user
            opts.db.decr(name);
            n = n - 1;
            return finish(ctx, next, opts.max, n, t);
          }
          // user maxed
          ctx.set('Retry-After', t);
          ctx.set('X-RateLimit-Remaining', n);
          ctx.status = 429;
          const retryTime = ms(expires, { long: true });
          ctx.body = `Rate limit exceeded, retry in ${retryTime}`;
          return true;
        });
      }
      opts.db.set(name, opts.max - 1, 'PX', opts.duration || 3600000, 'NX');
      return finish(ctx, next, opts.max, opts.max - 1, t);
    });
  };
}

/**
 * Expose `ratelimit()`.
 */
module.exports = ratelimit;
