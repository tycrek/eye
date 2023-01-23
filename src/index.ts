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
app.get('/:image/:variant?', async (ctx) => {
	let { image: imageName, variant: variantName } = ctx.req.param();

	// Check if KV_LAST_CACHED is set and if so, check if it's older than 1 hour
	const lastCached = await KV(ctx).get('KV_LAST_CACHED');
	const expired1hour: boolean = !lastCached || new Date(lastCached).getTime() < new Date().getTime() - 1000 * 60 * 60;
	const expired30Seconds: boolean = !lastCached || new Date(lastCached).getTime() < new Date().getTime() - 1000 * 30;

	// dev switch
	const expired = expired1hour;

	// Images array
	let images: Image[] = [];

	// Log
	console.log(`KV_LAST_CACHED: ${lastCached} (expired: ${expired})`);
	console.log(`We are ${expired ? 'fetching' : 'using cached'} images...`);

	const fetchImages = async () => {
		// Fetch images from Cloudflare API
		const json: ImageApiResult = await (await fetch(CF_IMAGES_API.replace('{account_identifier}', ctx.env.ACCOUNT_ID), { headers: { 'Authorization': `Bearer ${ctx.env.API_KEY}` } })).json();

		// Cache images in KV
		KV(ctx).put('KV_IMAGES', JSON.stringify(json.result.images));
		KV(ctx).put('KV_LAST_CACHED', new Date().toISOString());

		images = json.result.images;
	}

	// If KV_LAST_CACHED is set and not expired, fetch images from KV
	if (!expired) images = JSON.parse(await KV(ctx).get('KV_IMAGES'));
	else await fetchImages();

	// Find image
	const image: Image = images.find((img) => img.filename === imageName);
	if (!image) throw new Error(`Image not found: ${imageName}`);

	// Default to public variant
	if (!variantName) variantName = 'public';

	// Find variant
	const variantUrl = image.variants.find((v) => v.endsWith(variantName));
	if (!variantUrl) throw new Error(`Variant not found: ${variantName}`);

	// Fetch variant
	return fetch(variantUrl);
});

app.get('/*', (ctx) => (ctx.env.ASSETS as Fetcher).fetch(ctx.req));

export default app;
