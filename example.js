'use strict';

const ratelimit = require('./');
const redis = require('redis');
const koa = require('koa');
const app = module.exports = new koa();

// apply rate limit

app.use(ratelimit({
    db: redis.createClient(),
    duration: 60000,
    max: 100
}));

// response middleware

app.use(function(ctx, next) {
    ctx.body = 'Stuff!';
});

app.listen(4000);
console.log('listening on port 4000');