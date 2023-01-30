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

/**
 * Check if kache is expired
 */
const isExpred = (ctx: Context) => new Promise((resolve, reject) =>
	KV(ctx).get('KV_LAST_CACHED')
		.then((lastCached) => {
			const expired1hour: boolean = !lastCached || new Date(lastCached).getTime() < new Date().getTime() - 1000 * 60 * 60;
			const expired30Seconds: boolean = !lastCached || new Date(lastCached).getTime() < new Date().getTime() - 1000 * 30;

			const dev = false;
			resolve(dev ? expired30Seconds : expired1hour);
		})
		.catch((err) => reject(err)));

/**
 * Fetch images from Cloudflare API
 */
const fetchImages = (ctx: Context) => new Promise((resolve, reject) =>
	fetch(CF_IMAGES_API.replace('{account_identifier}', ctx.env.ACCOUNT_ID), { headers: { 'Authorization': `Bearer ${ctx.env.API_KEY}` } })
		.then((res) => res.json())
		.then((json: ImageApiResult) => {
			resolve(json.result.images);
			return Promise.all([
				KV(ctx).put('KV_IMAGES', JSON.stringify(json.result.images)),
				KV(ctx).put('KV_LAST_CACHED', new Date().toISOString()),
			]);
		})
		.then(([,]) => console.log('KV cache updated'))
		.catch((err) => reject(err)));

// KV routes
app
	// Bearer auth for KV
	.use('/api/kv/*', (ctx, next) => bearerAuth({ token: ctx.env.TOKEN })(ctx, next))

	// Get/Set KV value
	.get('/api/kv/:key', (ctx) => KV(ctx).get(ctx.req.param().key).then((value) => ctx.text(value)).catch((err) => kvErr(err, ctx)))
	.post('/api/kv/:key/:value', (ctx) => KV(ctx).put(ctx.req.param().key, ctx.req.param().value).catch((err) => kvErr(err, ctx)));

// Expire cache manually
app.get('/expire-cache', (ctx) =>
	Promise.all([KV(ctx).delete('KV_LAST_CACHED'), KV(ctx).delete('KV_IMAGES'), 'Cache expired'])
		.then(([, , msg]) => (console.log(msg), ctx.text(msg))));

// Lookup name -> id and vice versa
app.get('/lookup/:needle', (ctx) => {
	const { needle } = ctx.req.param();

	return isExpred(ctx)
		.then(async (expired) => (!expired) ? JSON.parse(await KV(ctx).get('KV_IMAGES')) : fetchImages(ctx))
		.then((images) => {
			const image: Image = images.find((img) => img.filename === needle || img.id === needle);
			if (!image) throw new Error(`Image not found: ${needle}`);

			return ctx.json(image);
		});
});

// Image relay
app.get('/:image/:variant?', (ctx) => {
	let { image: imageName, variant: variantName } = ctx.req.param();

	return isExpred(ctx)
		.then(async (expired) => (!expired) ? JSON.parse(await KV(ctx).get('KV_IMAGES')) : fetchImages(ctx))
		.then((images) => {
			// Find image
			const image: Image = images.find((img) => img.filename === imageName || img.id === imageName || img.filename.split('.')[0] === imageName.split('.')[0]);
			if (!image) throw new Error(`Image not found: ${imageName}`);

			// Default to public variant
			if (!variantName) variantName = 'public';

			// Find variant
			const variantUrl = image.variants.find((v) => v.endsWith(variantName));
			if (!variantUrl) throw new Error(`Variant not found: ${variantName}`);

			// Fetch variant
			return fetch(variantUrl)
				// Modify headers to attach original filename
				.then((res) => {
					// Clone the response so that it's no longer immutable
					const nres = new Response(res.body, res);
					nres.headers.append('Content-Disposition', `inline; filename="${image.filename}"`);
					return nres;
				});
		})
		.catch((err) => {
			ctx.status(500);
			return ctx.text(err.message);
		});
});

app.get('/*', (ctx) => (ctx.env.ASSETS as Fetcher).fetch(ctx.req));

export default app;
