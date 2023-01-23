import { Hono } from 'hono';
const app = new Hono();

app.get('/api', (ctx) => ctx.text('Welcome to the API'));

export default app;
