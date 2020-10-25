/* eslint-disable @typescript-eslint/promise-function-async */
import { describe, expect, beforeEach, it, afterAll } from '@jest/globals';
import Koa from 'koa';
import redis from 'redis';
import Redis from 'ioredis';
import request from 'supertest';
import delay from 'delay';

import { ratelimit } from '../src';

const redisDb = redis.createClient();
const ioDb = new Redis();

afterAll(async () => {
  redisDb.end(true);
  (ioDb as any).end(true);
  await delay(200);
});

describe.each([
  ['redis', redisDb],
  ['ioredis', ioDb],
])('ratelimit middleware with npm %s', (_: string, db: any) => {
  const rateLimitDuration = 300;
  const goodBody = 'Num times hit: ';

  beforeEach(async () => {
    await ioDb.flushall();
  });

  describe('limit', () => {
    let guard: number;
    const app = new Koa();

    app.use(
      ratelimit({
        duration: rateLimitDuration,
        db,
        max: 1,
      }),
    );

    app.use((ctx, next) => {
      guard += 1;
      ctx.body = `${goodBody}${guard}`;
      return next();
    });

    const routeHitOnlyOnce = (): void => {
      expect(guard).toBe(1);
    };

    beforeEach(async () => {
      guard = 0;

      await delay(rateLimitDuration);
      await request(app.callback())
        .get('/')
        .expect(200, `${goodBody}1`)
        .expect(routeHitOnlyOnce);
    });

    it('should respond with 429 when rate limit is exceeded', async () => {
      await request(app.callback())
        .get('/')
        .expect('X-RateLimit-Remaining', '0')
        .expect(429);
    });

    it('should not yield downstream if ratelimit is exceeded', async () => {
      await request(app.callback()).get('/').expect(429);

      routeHitOnlyOnce();
    });
  });

  describe('limit twice', () => {
    let guard: number;
    const app = new Koa();

    app.use(
      ratelimit({
        duration: rateLimitDuration,
        db,
        max: 2,
      }),
    );

    app.use((ctx, next) => {
      guard += 1;
      ctx.body = `${goodBody}${guard}`;
      return next();
    });

    const routeHitOnlyOnce = (): void => {
      expect(guard).toBe(1);
    };

    const routeHitTwice = (): void => {
      expect(guard).toBe(2);
    };

    beforeEach(async () => {
      guard = 0;
      await delay(rateLimitDuration * 2);
      await request(app.callback())
        .get('/')
        .expect(200, `${goodBody}1`)
        .expect(routeHitOnlyOnce);
      await request(app.callback())
        .get('/')
        .expect(200, `${goodBody}2`)
        .expect(routeHitTwice);
    });

    it('should respond with 429 when rate limit is exceeded', async () => {
      await request(app.callback())
        .get('/')
        .expect('X-RateLimit-Remaining', '0')
        .expect(429);
    });

    it('should not yield downstream if ratelimit is exceeded', async () => {
      await request(app.callback()).get('/').expect(429);
      routeHitTwice();
    });
  });

  describe('shortlimit', () => {
    let guard: number;

    const routeHitOnlyOnce = (): void => {
      expect(guard).toBe(1);
    };

    it('should fix an id with -1 ttl', async () => {
      const app = new Koa();

      app.use(
        ratelimit({
          duration: 1,
          db,
          max: 1,
          id: () => 'id',
        }),
      );

      app.use((ctx, next) => {
        guard += 1;
        ctx.body = `${goodBody}${guard}`;
        return next();
      });

      guard = 0;
      db.decr('limit:id:count');
      await request(app.callback())
        .get('/')
        .expect('X-RateLimit-Remaining', '0')
        .expect(routeHitOnlyOnce)
        .expect(200);
    });
  });

  describe('limit with throw', () => {
    it('responds with 429 when rate limit is exceeded', async () => {
      let guard = 0;
      const app = new Koa();

      app.use((ctx, next) =>
        next().catch(e => {
          ctx.body = e.message;
          ctx.set(e.headers);
        }),
      );

      app.use(
        ratelimit({
          duration: rateLimitDuration,
          db,
          max: 1,
          throw: true,
        }),
      );

      app.use((ctx, next) => {
        guard += 1;
        ctx.body = `${goodBody}${guard}`;
        return next();
      });

      await delay(rateLimitDuration);
      await request(app.callback()).get('/').expect(200, `${goodBody}1`);
      expect(guard).toBe(1);
      await request(app.callback())
        .get('/')
        .expect('X-RateLimit-Remaining', '0')
        .expect(429);
    });
  });

  describe('id', () => {
    it('should allow specifying a custom `id` function', async () => {
      const app = new Koa();

      app.use(
        ratelimit({
          db,
          duration: rateLimitDuration,
          max: 1,
          id: ctx => ctx.request.header.foo,
        }),
      );

      await request(app.callback())
        .get('/')
        .set('foo', 'bar')
        .expect(res => {
          expect(res.header['x-ratelimit-remaining']).toBe('0');
        });
    });

    it('should not limit if `id` returns `false`', async () => {
      const app = new Koa();

      app.use(
        ratelimit({
          db,
          duration: rateLimitDuration,
          id: () => false,
          max: 5,
        }),
      );

      await request(app.callback())
        .get('/')
        .expect(res =>
          expect(res.header['x-ratelimit-remaining']).toBeUndefined(),
        );
    });

    it('should limit using the `id` value', async () => {
      const app = new Koa();

      app.use(
        ratelimit({
          db,
          duration: rateLimitDuration,
          max: 1,
          id: ctx => ctx.request.header.foo,
        }),
      );

      app.use(async (ctx, next) => {
        ctx.body = ctx.request.header.foo;
        return next();
      });

      await request(app.callback())
        .get('/')
        .set('foo', 'buz')
        .expect(200, 'buz');

      await request(app.callback()).get('/').set('foo', 'buz').expect(429);
    });
    it('should allowlist using the `id` value', async () => {
      const app = new Koa();

      app.use(
        ratelimit({
          db,
          max: 1,
          id: ctx => ctx.header.foo,
          allowlist: ['bar'],
        }),
      );

      app.use(ctx => {
        ctx.body = ctx.header.foo;
      });

      await request(app.callback())
        .get('/')
        .set('foo', 'bar')
        .expect(200, 'bar');

      await request(app.callback())
        .get('/')
        .set('foo', 'bar')
        .expect(200, 'bar');
    });
    it('should blocklist using the `id` value', async () => {
      const app = new Koa();

      app.use(
        ratelimit({
          db,
          max: 1,
          id: ctx => ctx.header.foo,
          blocklist: ['bar'],
        }),
      );

      app.use(ctx => {
        ctx.body = ctx.header.foo;
      });

      await request(app.callback())
        .get('/')
        .set('foo', 'okay')
        .expect(200, 'okay');

      await request(app.callback()).get('/').set('foo', 'bar').expect(403);
    });
  });
});
