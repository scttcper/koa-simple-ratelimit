'use strict';

const ms = require('ms');

function ratelimit(opts) {
    opts = opts || {};

    function get(p) {
        return new Promise(function(resolve) {
            opts.db.get(p, function(err, reply) {
                resolve(reply);
            });
        });
    }

    function pttl(p) {
        return new Promise(function(resolve) {
            opts.db.pttl(p, function(err, reply) {
                resolve(reply);
            });
        });
    }

    function finish(ctx, next, n, t) {
        ctx.set('X-RateLimit-Limit', opts.max);
        ctx.set('X-RateLimit-Remaining', n);
        ctx.set('X-RateLimit-Reset', t);
        return next();
    }

    return function(ctx, next) {
        let id = opts.id ? opts.id(ctx) : ctx.ip;
        if (false === id) return next();
        let name = `limit:${id}:count`;
        return get(name).then(function(cur) {
            let n = ~~cur;
            let ex = opts.duration || 3600000;
            let t = Date.now();
            t += ex;
            t = new Date(t).getTime() / 1000 | 0;
            if (cur !== null) {
                return pttl(name).then(function(ex) {
                    if (n - 1 >= 0) {
                        // existing user
                        opts.db.decr(name);
                        n = n - 1;
                        return finish(ctx, next, n, t);
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
            opts.db.set(name, opts.max-1, 'PX', opts.duration || 3600000, 'NX');
            return finish(ctx, next, opts.max-1, t);
        });
    };
}
module.exports = ratelimit;