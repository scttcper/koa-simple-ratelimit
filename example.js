const redis = require('redis');
const Koa = require('koa');

const ratelimit = require('./');

const app = new Koa();

// Apply rate limit

app.use(ratelimit({
	db: redis.createClient(),
	duration: 60000,
	max: 100
}));

// Response middleware

app.use((ctx, next) => {
	ctx.body = 'Stuff!';
	return next();
});

app.listen(4000);
console.log('listening on port 4000');

module.exports = app;
