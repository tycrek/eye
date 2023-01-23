import { Hono } from 'hono';
const app = new Hono();

app.get('/api', (ctx) => ctx.text('Welcome to the API'));
app.get('/*', (ctx) => (ctx.env.ASSETS as Fetcher).fetch(ctx.req));

export default app;
