'use strict';

/**
 * Module dependencies.
 */
const ms = require('ms');

/**
 * Expose `ratelimit()`.
 */
module.exports = ratelimit;

function get(db, p) {
    return new Promise(function(resolve) {
        db.get(p, function(err, reply) {
            resolve(reply);
        });
    });
}

function pttl(db, p) {
    return new Promise(function(resolve) {
        db.pttl(p, function(err, reply) {
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

    return function(ctx, next) {
        let id = opts.id ? opts.id(ctx) : ctx.ip;
        if (false === id) return next();
        let name = `limit:${id}:count`;
        return get(opts.db, name).then(function(cur) {
            let n = ~~cur;
            let ex = opts.duration || 3600000;
            let t = Date.now();
            t += ex;
            t = new Date(t).getTime() / 1000 | 0;
            if (cur !== null) {
                return pttl(opts.db, name).then(function(ex) {
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
                    ctx.body = 'Rate limit exceeded, retry in ' + ms(ex, {
                        long: true
                    });
                    return;
                });
            }
            opts.db.set(name, opts.max - 1, 'PX', opts.duration || 3600000, 'NX');
            return finish(ctx, next, opts.max, opts.max - 1, t);
        });
    };
}
