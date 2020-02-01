import Koa from 'koa';
import redis from 'redis';

import { ratelimit } from './src';

const app = new Koa();

// Apply rate limit

app.use(
  ratelimit({
    db: redis.createClient(),
    duration: 60000,
    max: 100,
  }),
);

// Response middleware

app.use(async (ctx, next) => {
  ctx.body = 'Stuff!';
  return next();
});

app.listen(4000);
console.log('listening on port http://localhost:4000');

module.exports = app;
