import { Hono, Context } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';

/**
 * Create a new Hono app
 */
const app = new Hono();

/**
 * Batch size for fetching images from Cloudflare API (supports fetching 100 images at a time)
 */
const BATCH_SIZE = 100;

/**
 * Cloudflare Images API endpoint
 */
const CF_IMAGES_API = (accountId: string, page: number) => `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1?page=${page}&per_page=${BATCH_SIZE}`;

/**
 * Cloudflare API headers
 */
const HEADERS = (apiKey: string) => ({
	headers: {
		'Authorization': `Bearer ${apiKey}`,
		'Content-Type': 'application/json'
	}
});

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
 * Bytes to MiB (mebibytes) converter
 * Cloudflare Workers KV values are limited to 25 MiB
 * @unused
 */
const bytesToMiB = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);

/**
 * Attempts to find an image based on the name or ID provided
 */
const findImage = (needle: string, haystack: Image[]): Image | undefined => haystack.find((img) => img.filename.startsWith(needle) || img.id === needle);

/**
 * Strip file extension from filename
 */
const stripExt = (filename: string) => filename.replace(/\.[A-z]+$/g, '');

/**
 * 404 handler
 */
const http404 = (ctx: Context, err: any) => ctx.text(err.message, err.message.includes('not found') ? 404 : 500);

/**
 * KV error handler
 */
const kvErr = (ctx: Context, err: any) => ctx.json({ error: err.message }, 500);

/**
 * Get the KV namespace binding
 */
const KV = (ctx: Context) => (ctx.env.eye as KVNamespace);

/**
 * Check if image cache on KV is expired
 */
const isExpired = (ctx: Context) => new Promise((resolve, reject) =>
	KV(ctx).get('KV_LAST_CACHED')
		.then((lastCached) => {

			// Expirations: 1 hour; 30 seconds (for dev)
			const expired1hour: boolean = !lastCached || new Date(lastCached).getTime() < new Date().getTime() - 1000 * 60 * 60;
			const expired30Seconds: boolean = !lastCached || new Date(lastCached).getTime() < new Date().getTime() - 1000 * 30;

			const dev = false;
			resolve(dev ? expired30Seconds : expired1hour);
		})
		.catch(reject));

/**
 * Fetch images from Cloudflare API, using pagination if needed
 */
const fetchImages = (ctx: Context) => new Promise((resolve, reject) => {

	// Array to store all images
	const images: Image[] = [];

	/**
	 * Fetches the first page and any subsequent pages recursively
	 */
	const fetchAll = (page: number): Promise<Image[]> =>
		fetch(CF_IMAGES_API(ctx.env.ACCOUNT_ID, page), HEADERS(ctx.env.API_KEY))
			.then((res) => res.json())
			.then((json: ImageApiResult) => {

				// Add this batches images to the full set
				images.push(...json.result.images);

				// Fetch the next batch, if needed
				return (json.result.images.length === BATCH_SIZE)
					? fetchAll(page + 1)
					: images;
			});

	// Start fetching!
	console.log('Fetching images from Cloudflare API...');
	fetchAll(1)
		.then((images) => {

			// Resolve before caching to improve response time for end-user
			resolve(images);
			console.log(`Fetched images from Cloudflare API: ${images.length} images`);

			// Cache the response
			const fetchDate = new Date().toISOString();
			return Promise.all([
				KV(ctx).put('KV_IMAGES', JSON.stringify(images)),
				KV(ctx).put('KV_LAST_CACHED', fetchDate), fetchDate
			]);
		})
		.then(([, , fetchDate]) => console.log(`Images cached on KV: ${fetchDate}`))
		.catch(reject);
});

/**
 * Get an image from KV or Cloudflare API, depending on cache expiration status
 */
const getImage = (ctx: Context, needle: string) => isExpired(ctx)
	.then(async (expired) => (!expired) ? JSON.parse(await KV(ctx).get('KV_IMAGES')) : fetchImages(ctx))
	.then((images) => findImage(stripExt(needle), images))
	.then((image) => {
		if (!image) throw new Error(`Image not found: ${needle}`);
		return image;
	});

//#region KV routes
// KV routes
app
	// Bearer auth for KV
	.use('/api/kv/*', (ctx, next) => bearerAuth({ token: ctx.env.TOKEN })(ctx, next))

	// Get/Set KV value
	.get('/api/kv/:key', (ctx) => KV(ctx).get(ctx.req.param().key).then((value) => ctx.text(value)).catch((err) => kvErr(ctx, err)))
	.post('/api/kv/:key/:value', (ctx) => KV(ctx).put(ctx.req.param().key, ctx.req.param().value).catch((err) => kvErr(ctx, err)));

// Expire cache manually
app.get('/expire-cache', (ctx) =>
	Promise.all([KV(ctx).delete('KV_LAST_CACHED'), KV(ctx).delete('KV_IMAGES'), 'Cache expired'])
		.then(([, , msg]) => (console.log(msg), ctx.text(msg))));
//#endregion

// Lookup name -> id and vice versa
app.get('/lookup/:needle', (ctx) => getImage(ctx, ctx.req.param().needle)
	.then((image) => ctx.json(image))
	.catch((err) => http404(ctx, err)));

// Image relay
app.get('/:image/:variant?', (ctx) => {
	let { image: imageName, variant: variantName } = ctx.req.param();

	return getImage(ctx, imageName)
		.then((image) => {

			// Default to public variant
			const variantNeedle = variantName ?? 'public';

			// Find variant
			const variantUrl = image.variants.find((v) => v.endsWith(variantNeedle));
			if (!variantUrl) throw new Error(`Variant not found: ${variantNeedle}`);

			// Fetch variant
			return fetch(variantUrl)
				.then((res) => {

					// Clone the response so that it's no longer immutable
					const nres = new Response(res.body, res);

					// Add header so the response includes the original filename
					nres.headers.append('Content-Disposition', `inline; filename="${image.filename}"`);

					return nres;
				});
		})
		.catch((err) => http404(ctx, err));
});

app.get('/*', (ctx) => (ctx.env.ASSETS as Fetcher).fetch(ctx.req));

export default app;
