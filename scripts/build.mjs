/**
 * Собирает dist/ — ровно то, что публикует GitHub Pages.
 *
 * Что делает:
 *   1. Генерирует подстраницы из src/pages/*.html, подставляя их в каркас
 *      index.html (шапка, стили, скрипты, подвал — общие).
 *   2. Пересобирает FAQPage по тексту, который реально виден на странице.
 *   3. Считает SHA-256 инлайновых <style> и <script> и вписывает CSP —
 *      GitHub Pages не даёт управлять заголовками, это единственный способ.
 *   4. Проставляет сегодняшнюю дату в dateModified и lastmod.
 *
 * Запуск: npm run build
 */

import { createHash } from 'node:crypto';
import {
	cp,
	mkdir,
	readFile,
	readdir,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const DIST = 'dist';
const BASE = 'https://11alone11.github.io/Gruzoperevozki_ai';

// Копируются как есть
const STATIC_FILES = [
	'robots.txt',
	'site.webmanifest',
	'llms.txt',
	'llms-full.txt',
	// ключ IndexNow: файл должен называться <ключ>.txt и лежать в корне
	'gruzoperevozki-ai.txt',
];

const INLINE_STYLE = /<style>([\s\S]*?)<\/style>/g;
const INLINE_SCRIPT =
	/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g;

const kb = (bytes) => (bytes / 1024).toFixed(1);

const sha256 = (text) =>
	createHash('sha256').update(text, 'utf8').digest('base64');

const today = () => new Date().toISOString().slice(0, 10);

/** Убирает теги и лишние пробелы, чтобы текст совпал с видимым */
const plain = (html) =>
	html
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&mdash;/g, '—')
		.replace(/&laquo;/g, '«')
		.replace(/&raquo;/g, '»')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();

/**
 * Пересобирает FAQPage из того, что реально видно на странице.
 * Разметка не может разойтись с текстом — это требование Google.
 */
function syncFaq(html) {
	const items = [
		...html.matchAll(
			/<h3 class="faq__question">([\s\S]*?)<\/h3>\s*<p class="faq__answer">([\s\S]*?)<\/p>/g,
		),
	];

	const mainEntity = items.map(([, question, answer]) => ({
		'@type': 'Question',
		name: plain(question),
		acceptedAnswer: { '@type': 'Answer', text: plain(answer) },
	}));

	return html.replace(
		/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/,
		(match, open, body, close) => {
			let data;

			try {
				data = JSON.parse(body);
			} catch {
				return match;
			}

			if (!mainEntity.length) {
				data['@graph'] = data['@graph'].filter(
					(node) => node['@type'] !== 'FAQPage',
				);
				return open + JSON.stringify(data) + close;
			}

			const faq = (data['@graph'] || []).find(
				(node) => node['@type'] === 'FAQPage',
			);
			if (!faq) return match;

			faq.mainEntity = mainEntity;

			return open + JSON.stringify(data) + close;
		},
	);
}

/** Разбирает шапку вида «path: /…\ntitle: …» в начале фрагмента */
function parseFrontMatter(source) {
	const match = source.match(/^<!--\n([\s\S]*?)-->/);
	if (!match) return { meta: {}, content: source };

	const meta = {};

	for (const line of match[1].split('\n')) {
		const [key, ...rest] = line.split(':');
		if (!key || !rest.length) continue;
		meta[key.trim()] = rest.join(':').trim();
	}

	return { meta, content: source.slice(match[0].length).trimStart() };
}

/** Подставляет в каркас заголовок, описание, канонический адрес и контент */
function renderPage(shell, meta, content, sharedGraph) {
	const url = `${BASE}${meta.path}`;
	const crumb = meta.crumb || meta.title;

	// хлебные крошки — первым элементом контента
	const breadcrumbs = `\t\t\t<nav class="breadcrumbs" aria-label="Хлебные крошки">
\t\t\t\t<a class="breadcrumbs__link" href="./">Главная</a>
\t\t\t\t<span class="breadcrumbs__separator">/</span>
\t\t\t\t<span aria-current="page">${crumb}</span>
\t\t\t</nav>

`;

	content = content.replace(
		'<div class="page__content">',
		`<div class="page__content">\n${breadcrumbs}`,
	);

	return (
		shell
			.replace(/<title>[^<]*<\/title>/, `<title>${meta.title}</title>`)
			.replace(
				/name="description"\s*content="[^"]*"/,
				`name="description" content="${meta.description}"`,
			)
			.replace(
				/rel="canonical"\s*href="[^"]*"/,
				`rel="canonical" href="${url}"`,
			)
			.replace(
				/property="og:url"\s*content="[^"]*"/,
				`property="og:url" content="${url}"`,
			)
			.replace(
				/property="og:title"\s*content="[^"]*"/,
				`property="og:title" content="${meta.title}"`,
			)
			.replace(
				/property="og:description"\s*content="[^"]*"/,
				`property="og:description" content="${meta.description}"`,
			)
			.replace(
				/name="twitter:title"\s*content="[^"]*"/,
				`name="twitter:title" content="${meta.title}"`,
			)
			.replace(
				/name="twitter:description"\s*content="[^"]*"/,
				`name="twitter:description" content="${meta.description}"`,
			)
			.replace(
				/(<main class="page" id="main">)[\s\S]*(<\/main>)/,
				`$1\n${content}\n\t\t$2`,
			)
			// на подстранице логотип должен вести на главную
			.replace(
				'<a href="./" aria-label="Спецтехника Минск — на главную">',
				'<a href="../" aria-label="Спецтехника Минск — на главную">',
			)
			// текущая страница помечается в меню подвала
			.replace(
				`<a class="site-footer__nav-link" href="${meta.path.replace(/^\/|\/$/g, '')}/">`,
				`<a class="site-footer__nav-link" aria-current="page" href="${meta.path.replace(/^\/|\/$/g, '')}/">`,
			)
			// относительные пути из каркаса поднимаем на уровень выше
			.replace(
				/((?:src|href)=")(images\/|site\.webmanifest|sitemap\.xml|llms\.txt|arenda-pogruzchika-minsk\/|arenda-samosvala-minsk\/|uborka-snega-pogruzchikom\/)/g,
				'$1../$2',
			)
			// «на главную» на подстранице
			.replace(/(href=")\.\/(?=")/g, '$1../')
			.replace(
				/<script type="application\/ld\+json">[\s\S]*?<\/script>/,
				`<script type="application/ld+json">${JSON.stringify({
					'@context': 'https://schema.org',
					'@graph': [
						...sharedGraph,
						{
							'@type': 'WebPage',
							'@id': `${url}#webpage`,
							url,
							name: meta.title,
							description: meta.description,
							isPartOf: { '@id': `${BASE}/#website` },
							about: { '@id': `${BASE}/#business` },
							inLanguage: 'ru',
							datePublished: '2026-11-07',
							dateModified: '2026-11-07',
							speakable: {
								'@type': 'SpeakableSpecification',
								cssSelector: ['.hero__title', '.hero__lead'],
							},
						},
						{
							'@type': 'BreadcrumbList',
							'@id': `${url}#breadcrumbs`,
							itemListElement: [
								{
									'@type': 'ListItem',
									position: 1,
									name: 'Главная',
									item: `${BASE}/`,
								},
								{ '@type': 'ListItem', position: 2, name: crumb, item: url },
							],
						},
						{ '@type': 'FAQPage', '@id': `${url}#faq`, mainEntity: [] },
					],
				})}</script>`,
			)
	);
}

/**
 * Считает хеши инлайновых блоков и подставляет их в CSP.
 * Политика по умолчанию всё запрещает: сайту нужны только свои картинки,
 * один инлайновый <style> и один инлайновый <script>.
 */
function injectCsp(html) {
	const hashesOf = (source, pattern) =>
		[...source.matchAll(pattern)].map(
			(match) => `'sha256-${sha256(match[1])}'`,
		);

	const styleHashes = hashesOf(html, INLINE_STYLE);
	const scriptHashes = hashesOf(html, INLINE_SCRIPT);

	const allow = (hashes) =>
		hashes.length ? `'self' ${hashes.join(' ')}` : "'none'";

	const policy = [
		"default-src 'none'",
		"img-src 'self'",
		`style-src ${allow(styleHashes)}`,
		`script-src ${allow(scriptHashes)}`,
		"manifest-src 'self'",
		"connect-src 'self'",
		"base-uri 'none'",
		"form-action 'none'",
	];

	const meta = `<meta http-equiv="Content-Security-Policy" content="${policy.join('; ')}" />`;

	return html.replace(/(<meta charset="utf-8" \/>)/, `$1\n\t\t${meta}`);
}

/** Дата модификации, чтобы страница не выглядела заброшенной */
function setModifiedDate(html, date) {
	return html.replace(
		/"dateModified": "\d{4}-\d{2}-\d{2}"/,
		`"dateModified": "${date}"`,
	);
}

async function build() {
	await rm(DIST, { recursive: true, force: true });
	await mkdir(path.join(DIST, 'images'), { recursive: true });

	const date = today();
	const shell = await readFile('index.html', 'utf8');

	// Общие узлы разметки берём из каркаса: WebSite и LocalBusiness
	const shellLd = JSON.parse(
		shell.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1],
	);
	const sharedGraph = shellLd['@graph'].filter((node) =>
		['WebSite', 'LocalBusiness'].includes(node['@type']),
	);

	// Главная — каркас как есть
	const pages = [{ url: '/', html: shell }];

	// Подстраницы из фрагментов
	for (const file of (await readdir('src/pages')).sort()) {
		const raw = await readFile(path.join('src/pages', file), 'utf8');
		const { meta, content } = parseFrontMatter(raw);

		pages.push({
			url: meta.path,
			html: renderPage(shell, meta, content, sharedGraph),
		});
	}

	for (const page of pages) {
		const file =
			page.url === '/'
				? path.join(DIST, 'index.html')
				: path.join(DIST, page.url.replace(/^\/|\/$/g, ''), 'index.html');

		await mkdir(path.dirname(file), { recursive: true });

		const html = setModifiedDate(injectCsp(syncFaq(page.html)), date);
		await writeFile(file, html, 'utf8');
	}

	// 404 — вне каркаса, простая страница
	await cp('404.html', path.join(DIST, '404.html'));

	for (const file of STATIC_FILES) {
		await cp(file, path.join(DIST, file));
	}

	await writeSitemap(pages, date);

	// Без него GitHub Pages прогоняет файлы через Jekyll и игнорирует часть путей
	await writeFile(path.join(DIST, '.nojekyll'), '', 'utf8');

	let imageBytes = 0;

	for (const entry of await readdir('images', { withFileTypes: true })) {
		if (!entry.isFile()) continue;

		const from = path.join('images', entry.name);
		await cp(from, path.join(DIST, 'images', entry.name));
		imageBytes += (await stat(from)).size;
	}

	await verifyReferencedImages();
	await report(pages.length, imageBytes, date);
}

/** Карта сайта строится из фактического списка страниц */
async function writeSitemap(pages, date) {
	const template = await readFile('sitemap.xml', 'utf8');
	const [head, tail] = template.split('<url>');
	const lastBlock = tail.split('</url>').slice(-1)[0];

	const urls = pages
		.map((page) => {
			const priority = page.url === '/' ? '1.0' : '0.8';
			return `\t<url>
\t\t<loc>${BASE}${page.url}</loc>
\t\t<lastmod>${date}</lastmod>
\t\t<changefreq>monthly</changefreq>
\t\t<priority>${priority}</priority>
\t</url>`;
		})
		.join('\n');

	await writeFile(
		path.join(DIST, 'sitemap.xml'),
		`${head}${urls}${lastBlock}`,
		'utf8',
	);
}

/**
 * Страховка от опечатки в пути: каждая картинка из HTML
 * должна лежать в dist/. Иначе сборка упадёт ещё в CI.
 */
async function verifyReferencedImages() {
	const html = await readFile(path.join(DIST, 'index.html'), 'utf8');
	const referenced = new Set(
		[
			...html.matchAll(/images\/[A-Za-z0-9_.-]+\.(?:avif|webp|svg|png|jpg)/g),
		].map(([match]) => match),
	);

	const missing = [];

	for (const ref of referenced) {
		try {
			await stat(path.join(DIST, ref));
		} catch {
			missing.push(ref);
		}
	}

	if (missing.length) {
		throw new Error(`В dist/ не хватает картинок:\n  ${missing.join('\n  ')}`);
	}
}

async function report(pageCount, imageBytes, date) {
	const files = [];

	async function walk(dir) {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) await walk(full);
			else files.push({ full, size: (await stat(full)).size });
		}
	}

	await walk(DIST);

	const total = files.reduce((sum, file) => sum + file.size, 0);
	const html = files
		.filter((file) => file.full.endsWith('index.html'))
		.reduce((sum, file) => sum + file.size, 0);

	console.log(
		`dist/ собран: ${files.length} файлов, ${kb(total)} КБ (${date})`,
	);
	console.log(`  страниц    — ${pageCount}`);
	console.log(`  HTML всего — ${kb(html)} КБ`);
	console.log(`  картинки   — ${kb(imageBytes)} КБ`);
}

await build();
