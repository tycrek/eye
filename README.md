<div align="center">

👁 eye
===

*Custom domain relay for Cloudflare Images*

</div>

## Getting Started

First, upload some files to [Cloudflare Images](https://www.cloudflare.com/en-ca/products/cloudflare-images/). Then, clone this repository and install the dependencies:

```bash
git clone https://github.com/tycrek/eye.git && cd eye
npm i
```

### Bindings

eye uses [Cloudflare Workers KV](https://developers.cloudflare.com/workers/learning/how-kv-works/) to avoid polling the Cloudflare Images API all the time. To use this, you must create a KV namespace and bind it to the worker. You can do this in the [Workers dashboard](https://dash.cloudflare.com/?to=/:account/workers/kv/namespaces).

eye expects the namespace to be called `eye`. For publishing, ensure your project is also called `eye`.

### Environment Variables

For local dev, put these variables in a file called `.dev.vars` (formatted the same as a typical `.env`).

For production, set these values on the dashboard.

- **`TOKEN`** is used for requests to eye's KV API. Set to a random string.
- **`ACCOUNT_ID`** can be found on the right-hand side of the Images dashboard, under **Developer Resources**.
- **`ACCOUNT_HASH`** is located below the **Account ID** on the same page.
- **`API_KEY`** must be created in the **[API Tokens](https://dash.cloudflare.com/profile/api-tokens)** page. Make sure you give your key access to `Account.Cloudflare Images`.

## Usage

To run **locally**, run `npm run dev`. This will launch the Wrangler dev server (press `B` to open the browser).

To **publish**, run `npm run publish`. This will build the project and publish it to Cloudflare Workers, under the project name `eye`.

## API

### `GET /lookup/:needle`

Returns the JSON info of the filename or ID provided.

### `GET /:image/:variant?`

Returns the image for the given image name and variant. If no variant is provided, the default `public` variant is used.

## Stack

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) - serverless hosting
- [Hono.js](https://honojs.dev/) - backend
- [Pagery](https://github.com/tycrek/pagery) - frontend (landing page)
