import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
const app = new Hono();

app.get('/api', (ctx) => ctx.text('Welcome to the API'));

app // Bearer auth for KV
	.use('/api/kv/*', (ctx, next) => bearerAuth({ token: ctx.env.TOKEN })(ctx, next))
app.get('/*', (ctx) => (ctx.env.ASSETS as Fetcher).fetch(ctx.req));

export default app;
