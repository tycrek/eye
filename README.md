<div align="center">

👁 eye
===

*Custom domain relay for Cloudflare Images*

</div>

## Getting Started

First, upload some files to [Cloudflare Images](https://www.cloudflare.com/en-ca/products/cloudflare-images/). For local development, clone this repository and install the dependencies:

```bash
git clone https://github.com/tycrek/eye.git && cd eye
npm i
```

You will also need to do this to publish the project to Cloudflare Workers.

### Bindings

eye uses [Cloudflare Workers KV](https://developers.cloudflare.com/workers/learning/how-kv-works/) to avoid polling the Cloudflare Images API all the time. To use this, you must create a KV namespace and bind it to the worker. You can do this in the [Workers dashboard](https://dash.cloudflare.com/?to=/:account/workers/kv/namespaces).

eye expects the namespace to be called `eye`. For publishing, ensure your project is also called `eye`.

### Preliminary steps

To get started, log into your Cloudflare account. You will need to grab two values: 

- **`ACCOUNT_ID`** can be found on the right-hand side of the [Images dashboard](https://dash.cloudflare.com/?to=/:account/images), under **Developer Resources**.
- **`API_KEY`** must be created in the **[API Tokens](https://dash.cloudflare.com/profile/api-tokens)** page. Make sure you give your key **read** access to `Account.Cloudflare Images`.

### Setup

Once you have your `ACCOUNT_ID` and `API_KEY`, visit your deployment in the browser at `http://your.eye.domain/setup`. You will be prompted to enter these values. Once you do, eye will begin to populate the KV namespace with your images.

## Usage

To run **locally**, run `npm run dev`. This will launch the Wrangler dev server (press `B` to open the browser).

To **publish**, run `npm run publish`. This will build the project and publish it to Cloudflare Workers, under the project name `eye`.

## API

### `GET /.lookup/:needle`

Returns the JSON info of the filename or ID provided.

### `GET /:image/:variant?`

Returns the image for the given image name and variant. If no variant is provided, the default `public` variant is used.

The `image` parameter can be either the filename or UUID of the image. File extensions are optional.

### `GET /.expire-cache`

Expires the image cache manually. This is done automatically every 24 hours, but can be done manually if needed.

You may want to do this if you have updated an image and want to see the changes immediately. It is recommended to use the next route after this one.

### `GET /.update-cache`

Updates the image cache manually. This is done automatically every 24 hours, but can be done manually if needed.

You will have to expire the cache first, if it is not already expired.

#### Why dots in the routes?

This helps avoid issues with files that match these route names. Though this is unlikely, it is still possible.

## Stack

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) - serverless hosting
- [Hono.js](https://hono.dev/) - backend
- [Pagery](https://github.com/tycrek/pagery) - frontend (landing & setup page)
