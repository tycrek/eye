import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
const app = new Hono();

app.get('/api', (ctx) => ctx.text('Welcome to the API'));

app // Bearer auth for KV
	.use('/api/kv/*', (ctx, next) => bearerAuth({ token: ctx.env.TOKEN })(ctx, next))

	// Get KV value
	.get('/api/kv/:key', (ctx) =>
		(ctx.env.eye as KVNamespace).get(ctx.req.param().key)
			.then((value) => ctx.json({ value }))
			.catch((err) => (ctx.status(400), ctx.json({ error: err.message }))))

	// Set KV value
	.post('/api/kv/:key/:value', (ctx) =>
		(ctx.env.eye as KVNamespace).put(ctx.req.param().key, ctx.req.param().value)
			.then(() => ctx.json({ success: true }))
			.catch((err) => (ctx.status(400), ctx.json({ error: err.message }))));

app.get('/*', (ctx) => (ctx.env.ASSETS as Fetcher).fetch(ctx.req));

export default app;
