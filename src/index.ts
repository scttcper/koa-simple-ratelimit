import logger from 'debug';
import ms from 'ms';
import { RedisClient } from 'redis';

const debug = logger('koa-simple-ratelimit');

async function find(db: RedisClient, p: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    db.get(p, (err, reply) => {
      if (err) {
        reject(err);
      }

      resolve(reply);
    });
  });
}

async function pttl(db: RedisClient, p: string): Promise<number> {
  return new Promise((resolve, reject) => {
    db.pttl(p, (err, reply) => {
      if (err) {
        reject(err);
      }

      resolve(reply);
    });
  });
}

export type RatelimitExpires = (expires: number) => string;

export interface RatelimitOptions {
  /**
   * database connection
   */
  db: any;
  /**
   * limit duration in milliseconds [1 hour]
   */
  duration?: number;
  /**
   * max requests per 'id' default: 2500
   */
  max?: number;
  /**
   * id to compare requests default: ip
   */
  id?: (ctx: any) => string | false;
  /**
   * redis key prefix default: "limit"
   */
  prefix?: string;
  /**
   * array of ids to always allow
   */
  allowlist?: string[];
  /**
   * array of ids to always deny
   */
  blocklist?: string[];
  /**
   * throw on rate limit exceeded default: false
   */
  throw?: boolean;
  /**
   * error returned as the body of the response
   */
  errorMessage?: string | RatelimitExpires;
  /**
   * custom header names
   */
  headers?: {
    /**
     * remaining number of requests default: 'X-RateLimit-Remaining'
     */
    remaining?: string;
    /**
     * reset timestamp default: 'X-RateLimit-Reset'
     */
    reset?: string;
    /**
     * total number of requests default: 'X-RateLimit-Limit'
     */
    total?: string;
  };
}

/**
 * Initialize ratelimit middleware with the given `opts`
 */
export function ratelimit(
  options: RatelimitOptions,
): (...args: any[]) => Promise<any> {
  const opts: Required<RatelimitOptions> = {
    max: 2500,
    duration: 3600000,
    throw: false,
    prefix: 'limit',
    id: (ctx: any): string => ctx.ip,
    allowlist: [],
    blocklist: [],
    headers: {
      remaining: 'X-RateLimit-Remaining',
      reset: 'X-RateLimit-Reset',
      total: 'X-RateLimit-Limit',
    },
    errorMessage: (exp: number) =>
      `Rate limit exceeded, retry in ${ms(exp, { long: true })}.`,
    ...options,
  };
  const {
    remaining = 'X-RateLimit-Remaining',
    reset = 'X-RateLimit-Reset',
    total = 'X-RateLimit-Limit',
  } = opts.headers || {};

  // eslint-disable-next-line func-names
  return async function rateLimitMiddleware(ctx, next) {
    const id = opts.id(ctx);

    if (id === false) {
      return next();
    }

    if (opts.allowlist?.includes(id)) {
      return next();
    }

    if (opts.blocklist?.includes(id)) {
      return ctx.throw(403);
    }

    const prefix = opts.prefix ? opts.prefix : 'limit';
    const name = `${prefix}:${id}:count`;
    const cur = await find(opts.db, name);
    const n = Math.floor(Number(cur));
    let t = Date.now();
    t += opts.duration;
    t = Math.floor(new Date(t).getTime() / 1000) || 0;

    const headers = {
      [remaining]: opts.max - 1,
      [reset]: t,
      [total]: opts.max,
    };
    ctx.set(headers);

    // Not existing in redis
    if (cur === null) {
      opts.db.set(name, opts.max - 1, 'PX', opts.duration, 'NX');
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
      opts.db.set(name, opts.max - 1, 'PX', opts.duration, 'NX');
      return next();
    }

    // User maxed
    debug('remaining %s/%s %s', remaining, opts.max, id);
    ctx.set(remaining, n);
    ctx.set('Retry-After', t);
    ctx.status = 429;
    if (typeof opts.errorMessage === 'function') {
      ctx.body = opts.errorMessage(expires);
    } else {
      ctx.body = opts.errorMessage;
    }

    if (opts.throw) {
      ctx.throw(ctx.status, ctx.body, { headers });
    }
  };
}
