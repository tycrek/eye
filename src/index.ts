import { Hono, Context } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';

/**
 * Create a new Hono app
 */
const app = new Hono();

/**
 * Cloudflare Images API endpoint
 */
const CF_IMAGES_API = 'https://api.cloudflare.com/client/v4/accounts/{account_identifier}/images/v1';

/**
 * Represents a Cloudflare Image
 */
interface Image {
	id: string;
	filename: string;
	uploaded: string;
	requireSignedURLs: boolean;
	variants: string[];
}

/**
 * Represents the result of the Cloudflare Images API
 */
interface ImageApiResult {
	result: {
		images: Image[];
	}
}

/**
 * KV error handler
 */
const kvErr = (err: any, ctx: Context) => (ctx.status(400), ctx.json({ error: err.message }));

/**
 * KV namespace
 */
const KV = (ctx: Context) => (ctx.env.eye as KVNamespace);

// KV routes
app
	// Bearer auth for KV
	.use('/api/kv/*', (ctx, next) => bearerAuth({ token: ctx.env.TOKEN })(ctx, next))

	// Get/Set KV value
	.get('/api/kv/:key', (ctx) => KV(ctx).get(ctx.req.param().key).then((value) => ctx.text(value)).catch((err) => kvErr(err, ctx)))
	.post('/api/kv/:key/:value', (ctx) => KV(ctx).put(ctx.req.param().key, ctx.req.param().value).catch((err) => kvErr(err, ctx)));

// Image relay
app.get('/:image/:variant?', (ctx) => {
	let { image: imageName, variant: variantName } = ctx.req.param();

	return fetch(CF_IMAGES_API.replace('{account_identifier}', ctx.env.ACCOUNT_ID), { headers: { 'Authorization': `Bearer ${ctx.env.API_KEY}` } })
		.then((res) => res.json())

		// Find image
		.then((json: ImageApiResult) => {
			const image: Image = json.result.images.find((img) => img.filename === imageName);
			if (!image) throw new Error('Image not found');
			return image;
		})

		// Find variant
		.then((image) => {

			// Default to public variant
			if (!variantName) variantName = 'public';

			const variantUrl = image.variants.find((v) => v.endsWith(variantName));
			if (!variantUrl) throw new Error('Variant not found');
			return variantUrl;
		})

		// Fetch variant
		.then(fetch);
});

app.get('/*', (ctx) => (ctx.env.ASSETS as Fetcher).fetch(ctx.req));

export default app;
