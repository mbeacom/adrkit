// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	// Apex custom domain (GitHub Pages, see site/DEPLOYMENT.md + public/CNAME).
	// Also the origin baked into the JSON Schema `$id`.
	site: 'https://adrkit.dev',
	integrations: [
		starlight({
			title: 'adrkit',
			description:
				'Decision memory for human- and agent-authored plans — machine-readable ADRs, enforceable in CI, legible to agents, without leaving git.',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/mbeacom/adrkit' },
			],
			editLink: {
				baseUrl: 'https://github.com/mbeacom/adrkit/edit/main/site/',
			},
			sidebar: [
				{
					label: 'Start here',
					items: [
						{ label: 'Overview', link: '/' },
						{ label: 'Quickstart', slug: 'quickstart' },
					],
				},
				{
					label: 'Reference',
					items: [{ label: 'JSON Schema', slug: 'schema' }],
				},
				{
					label: 'Decision records',
					items: [{ autogenerate: { directory: 'adr' } }],
				},
			],
		}),
	],
});
