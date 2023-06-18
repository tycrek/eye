import { Hono, Context } from 'hono';

/**
 * Bindings introduced for Hono v3.0.0
 */
type Bindings = {
	/**
	 * Static asset fetcher for Pages
	 */
	ASSETS: Fetcher;

	/**
	 * KV namespace for storing image information
	 */
	eye: KVNamespace;
}

/**
 * Create a new Hono app
 */
const app = new Hono<{ Bindings: Bindings }>();

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
const findImage = (needle: string, haystack: Image[]): Image | undefined => haystack.find((img) => img.filename.startsWith(needle) || img.id.startsWith(needle));

/**
 * Strip file extension from filename
 */
const stripExt = (filename: string) => filename.replace(/\.[A-z]+$/g, '');

/**
 * Check if `eye` is available
 */
const isKvReady = (ctx: Context): Promise<boolean> => new Promise((resolve, reject) => {
	try {
		const eye = ctx.env.eye as KVNamespace | undefined;
		if (!eye) throw new Error('KV namespace not found');
		resolve(true);
	} catch (err) {
		reject(err);
	}
});

/**
 * Check if image cache on KV is expired
 */
const isExpired = (ctx: Context) => new Promise((resolve, reject) =>
	isKvReady(ctx)
		.then(() => ctx.env.eye.get('KV_LAST_CACHED'))
		.then((lastCached) => {

			// Expirations: 1 hour; 30 seconds (for dev)
			const expired1hour: boolean = !lastCached || new Date(lastCached).getTime() < new Date().getTime() - 1000 * 60 * 60;
			const expired30Seconds: boolean = !lastCached || new Date(lastCached).getTime() < new Date().getTime() - 1000 * 30;
			const expired24hours: boolean = !lastCached || new Date(lastCached).getTime() < new Date().getTime() - 1000 * 60 * 60 * 24;

			const dev = false;
			const longTerm = true;
			resolve(dev ? expired30Seconds : longTerm ? expired24hours : expired1hour);
		})
		.catch(reject));

/**
 * Fetch images from Cloudflare API, using pagination if needed
 */
const fetchImages = (ctx: Context) => new Promise(async (resolve, reject) => {

	// Check if KV is ready
	const kvReady = await isKvReady(ctx);
	if (!kvReady) return reject('KV namespace not found');

	// Array to store all images
	const images: Image[] = [];

	// Try and get the ACCOUNT_ID and API_KEY from KV
	const accountId = await ctx.env.eye.get('ACCOUNT_ID');
	const apiKey = await ctx.env.eye.get('API_KEY');

	/**
	 * Fetches the first page and any subsequent pages recursively
	 */
	const fetchAll = (page: number): Promise<Image[]> =>
		fetch(CF_IMAGES_API(accountId, page), HEADERS(apiKey))
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
				ctx.env.eye.put('KV_IMAGES', JSON.stringify(images)),
				ctx.env.eye.put('KV_LAST_CACHED', fetchDate), fetchDate
			]);
		})
		.then(([, , fetchDate]) => console.log(`Images cached on KV: ${fetchDate}`))
		.catch(reject);
});

/**
 * Get an image from KV or Cloudflare API, depending on cache expiration status
 */
const getImage = (ctx: Context, needle: string) =>
	isKvReady(ctx)
		.then(() => isExpired(ctx))
		.then(async (expired) => (!expired) ? JSON.parse(await ctx.env.eye.get('KV_IMAGES')) : fetchImages(ctx))
		.then((images) => findImage(stripExt(needle), images))
		.then((image) => {
			if (!image) throw new Error(`Image not found: ${needle}`);
			return image;
		});

/**
 * Quick-method to fetch static assets
 */
const assets = (ctx: Context) => (ctx.env.ASSETS as Fetcher).fetch(ctx.req.raw);

// Static asset routes(robots.txt, ui.js)
app
	.get('/robots.txt', assets)
	.get('/ui.js', assets);

// Setup flow
app
	.get('/setup', assets)
	.post(async (ctx) => {

		// Get the ACCOUNT_ID and API_KEY from the request body
		const { ACCOUNT_ID, API_KEY } = await ctx.req.json();

		// Check if we can fetch images
		const res = await fetch(CF_IMAGES_API(ACCOUNT_ID, 1), HEADERS(API_KEY));
		if (!res.ok) throw new Error('Invalid credentials');

		// Check if KV is ready
		const kvReady = await isKvReady(ctx);
		if (!kvReady) throw new Error('KV not ready');

		// Save credentials
		await Promise.all([
			ctx.env.eye.put('ACCOUNT_ID', ACCOUNT_ID),
			ctx.env.eye.put('API_KEY', API_KEY)
		]);

		return ctx.text('Setup complete');
	});

// Expire cache manually
app.get('/.expire-cache', (ctx) =>
	isKvReady(ctx)
		.then(() => Promise.all([ctx.env.eye.delete('KV_LAST_CACHED'), 'Cache expired']))
		.then(([, msg]) => (console.log(msg), ctx.text(msg))));

app.get('/.update-cache', async (ctx) => {

	// Check if KV is ready
	const kvReady = await isKvReady(ctx);
	if (!kvReady) return ctx.text('KV namespace not found, please bind a KV namespace with the name `eye`', 400);

	// Check if the cache is expired
	const expired = await isExpired(ctx);
	if (!expired) return ctx.text('Cache not expired');

	// Fetch images
	await fetchImages(ctx);

	// Return a message
	return ctx.text('Cache updated');
});

// Lookup name -> id and vice versa
app.get('/.lookup/:needle', (ctx) =>
	isKvReady(ctx)
		.then(() => getImage(ctx, ctx.req.param().needle))
		.then((image) => ctx.json(image)));

// Index
app.get('/', async (ctx) => {

	// Check if KV is ready
	const kvReady = await isKvReady(ctx);
	if (!kvReady) return ctx.text('KV namespace not found, please bind a KV namespace with the name `eye`', 400);

	// Check required variables in KV
	const accountId = await ctx.env.eye.get('ACCOUNT_ID');
	const apiKey = await ctx.env.eye.get('API_KEY');
	if (!accountId || !apiKey) return ctx.text('Missing Cloudflare credentials, please run `/setup`', 400);

	// Otherwise, get the index
	return assets(ctx);
});

// Image relay
app.get('/:image/:variant?', (ctx) =>
	isKvReady(ctx)
		.then(() => getImage(ctx, ctx.req.param().image))
		.then((image) => {

			// Default to public variant
			const variantNeedle = ctx.req.param().variant ?? 'public';

			// Find variant
			const variantUrl = image.variants.find((v) => v.endsWith(variantNeedle));
			if (!variantUrl) throw new Error(`Variant not found: ${variantNeedle}`);

			// Fetch variant
			return Promise.all([fetch(variantUrl), image, variantUrl]);
		})
		.then(([variantResponse, image, variantUrl]) => {

			// Clone the response so that it's no longer immutable
			const nres = new Response(variantResponse.body, variantResponse);

			// Add header so the response includes the original filename
			nres.headers.append('Content-Disposition', `inline; filename="${image.filename}"`);

			// Add headers including the original image URL and UUID
			nres.headers.append('X-Original-Url', variantUrl);
			nres.headers.append('X-Image-Id', image.id);

			return nres;
		}));

app.onError((err, ctx) => ctx.text(err.message, err.message.includes('not found') ? 404 : 500));

export default app;
