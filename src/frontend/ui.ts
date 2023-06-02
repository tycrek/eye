import { SlInput, SlButton } from '@shoelace-style/shoelace';

// * Wait for the document to be ready
document.addEventListener('DOMContentLoaded', () => {
	const accountIdElm = document.querySelector('#account-id') as SlInput;
	const apiKeyElm = document.querySelector('#api-key') as SlInput;
	const submitButtonElm = document.querySelector('#submit') as SlButton;

	// * Setup button click handler
	submitButtonElm.addEventListener('click', async () => {

		// Disable button
		submitButtonElm.disabled = true;

		// Get values
		const accountId = accountIdElm.value;
		const apiKey = apiKeyElm.value;

		// Check if values are valid
		if (!accountId || !apiKey || accountId.length === 0 || apiKey.length === 0) {
			alert('Please enter a valid Account ID and API Key');
			submitButtonElm.disabled = false;
			return;
		}

		// Save values to KV
		fetch('/setup', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ACCOUNT_ID: accountId, API_KEY: apiKey })
		})
			.then((res) => {
				if (!res.ok) throw new Error('Invalid credentials');
				return res.text();
			})

			// Setup complete
			.then((msg) => (alert(msg), window.location.href = '/'))

			// Error, reset button
			.catch((err) => (alert(err), submitButtonElm.disabled = false));
	});
});
