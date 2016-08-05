/* eslint-env mocha */
/* eslint import/no-extraneous-dependencies: ["error", {"devDependencies": true}] */
'use strict';

const Koa = require('koa');
const request = require('supertest');
const should = require('should');
const redis = require('redis');

const ratelimit = require('..');

const db = redis.createClient();

describe('ratelimit middleware', () => {
  const rateLimitDuration = 1000;
  const goodBody = 'Num times hit: ';

  before((done) => {
    db.keys('limit:*', (err, rows) => {
      rows.forEach(db.del, db);
    });

    done();
  });

  describe('limit', () => {
    let guard;
    let app;

    const routeHitOnlyOnce = () => {
      guard.should.be.equal(1);
    };

    beforeEach((done) => {
      app = new Koa();

      app.use(ratelimit({
        duration: rateLimitDuration,
        db: db,
        max: 1,
      }));

      app.use((ctx, next) => {
        guard++;
        ctx.body = goodBody + guard;
        return next();
      });

      guard = 0;

      setTimeout(() => {
        request(app.listen())
          .get('/')
          .expect(200, `${goodBody}1`)
          .expect(routeHitOnlyOnce)
          .end(done);
      }, rateLimitDuration);
    });

    it('responds with 429 when rate limit is exceeded', (done) => {
      request(app.listen())
        .get('/')
        .expect('X-RateLimit-Remaining', '0')
        .expect(429)
        .end(done);
    });

    it('should not yield downstream if ratelimit is exceeded', (done) => {
      request(app.listen())
        .get('/')
        .expect(429)
        .end(() => {
          routeHitOnlyOnce();
          done();
        });
    });
  });

  describe('limit with throw', () => {
    let guard;
    let app;

    const routeHitOnlyOnce = () => {
      guard.should.be.equal(1);
    };

    beforeEach((done) => {
      app = new Koa();

      app.use((ctx, next) => next()
        .catch((e) => {
          ctx.body = e.message;
          ctx.set(e.headers);
        }));

      app.use(ratelimit({
        duration: rateLimitDuration,
        db: db,
        max: 1,
        throw: true,
      }));

      app.use((ctx, next) => {
        guard++;
        ctx.body = goodBody + guard;
        return next();
      });

      guard = 0;

      setTimeout(() => {
        request(app.listen())
          .get('/')
          .expect(200, `${goodBody}1`)
          .expect(routeHitOnlyOnce)
          .end(done);
      }, rateLimitDuration);
    });

    it('responds with 429 when rate limit is exceeded', (done) => {
      request(app.listen())
        .get('/')
        .expect('X-RateLimit-Remaining', '0')
        .expect(429)
        .end(done);
    });
  });

  describe('id', () => {
    it('should allow specifying a custom `id` function', (done) => {
      const app = new Koa();

      app.use(ratelimit({
        db: db,
        duration: rateLimitDuration,
        max: 1,
        id: (ctx) => ctx.request.header.foo,
      }));

      request(app.listen())
        .get('/')
        .set('foo', 'bar')
        .expect((res) => {
          res.header['x-ratelimit-remaining'].should.equal('0');
        })
        .end(done);
    });

    it('should not limit if `id` returns `false`', (done) => {
      const app = new Koa();

      app.use(ratelimit({
        db: db,
        duration: rateLimitDuration,
        id: () => false,
        max: 5,
      }));

      request(app.listen())
        .get('/')
        .expect((res) => {
          res.header.should.not.have.property('x-ratelimit-remaining');
        })
        .end(done);
    });

    it('should limit using the `id` value', (done) => {
      const app = new Koa();

      app.use(ratelimit({
        db: db,
        duration: rateLimitDuration,
        max: 1,
        id: (ctx) => ctx.request.header.foo,
      }));

      app.use((ctx, next) => {
        ctx.body = ctx.request.header.foo;
        return next();
      });

      request(app.listen())
        .get('/')
        .set('foo', 'bar')
        .expect(200, 'bar')
        .end(() => {
          request(app.listen())
            .get('/')
            .set('foo', 'biz')
            .expect(200, 'biz')
            .end(done);
        });
    });
    it('should whitelist using the `id` value', done => {
      const app = new Koa();

      app.use(ratelimit({
        db: db,
        max: 1,
        id: ctx => ctx.header.foo,
        whitelist: ['bar'],
      }));

      app.use(ctx => {
        ctx.body = ctx.header.foo;
      });

      request(app.listen())
        .get('/')
        .set('foo', 'bar')
        .expect(200, 'bar')
        .end(() => {
          request(app.listen())
            .get('/')
            .set('foo', 'bar')
            .expect(200, 'bar')
            .end(done);
        });
    });
    it('should blacklist using the `id` value', done => {
      const app = new Koa();

      app.use(ratelimit({
        db: db,
        max: 1,
        id: ctx => ctx.header.foo,
        blacklist: 'bar',
      }));

      app.use(ctx => {
        ctx.body = ctx.header.foo;
      });

      request(app.listen())
        .get('/')
        .set('foo', 'bar')
        .expect(200, 'bar')
        .end(() => {
          request(app.listen())
            .get('/')
            .set('foo', 'bar')
            .expect(403)
            .end(done);
        });
    });
  });
});
