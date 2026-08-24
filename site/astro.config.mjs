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
			customCss: ['./src/styles/custom.css'],
			head: [
				// Static social card (site/public/og.png). twitter:card must be
				// declared explicitly — Starlight does not synthesize it — or a
				// shared link renders without the image. Absolute URLs are
				// required by scrapers.
				{
					tag: 'meta',
					attrs: { property: 'og:image', content: 'https://adrkit.dev/og.png' },
				},
				{
					tag: 'meta',
					attrs: { property: 'og:image:width', content: '1200' },
				},
				{
					tag: 'meta',
					attrs: { property: 'og:image:height', content: '630' },
				},
				// Platforms render the card with no text alternative unless this is
				// declared; a shared link is otherwise announced as bare "image".
				{
					tag: 'meta',
					attrs: {
						property: 'og:image:alt',
						content:
							'adrkit — decision memory for human- and agent-authored plans. Machine-readable ADRs, enforceable in CI, on npm at adrkit.dev.',
					},
				},
				{
					tag: 'meta',
					attrs: { name: 'twitter:card', content: 'summary_large_image' },
				},
				{
					tag: 'meta',
					attrs: { name: 'twitter:image', content: 'https://adrkit.dev/og.png' },
				},
				{
					tag: 'meta',
					attrs: {
						name: 'twitter:image:alt',
						content:
							'adrkit — decision memory for human- and agent-authored plans. Machine-readable ADRs, enforceable in CI, on npm at adrkit.dev.',
					},
				},
			],
			components: {
				Hero: './src/components/Hero.astro',
				SiteTitle: './src/components/SiteTitle.astro',
			},
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
						{ label: 'Why adrkit', link: '/' },
						{ label: 'Quickstart', slug: 'quickstart' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'Use in CI', slug: 'ci' },
						{ label: 'Badges', slug: 'badges' },
						{ label: 'MCP setup', slug: 'mcp' },
						{ label: 'Spec Kit extension', slug: 'spec-kit' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'Command reference', slug: 'commands' },
						{ label: 'JSON Schema', slug: 'schema' },
					],
				},
				{
					label: 'Decision records',
					items: [{ autogenerate: { directory: 'adr' } }],
				},
			],
		}),
	],
});
