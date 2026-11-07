/**
 * Собирает dist/ — ровно то, что публикует GitHub Pages.
 *
 * Помимо копирования файлов сборка делает одну важную вещь: считает SHA-256
 * инлайновых <style> и <script> и вписывает Content-Security-Policy в <meta>.
 * GitHub Pages не позволяет задавать HTTP-заголовки, поэтому CSP — единственный
 * способ запретить браузеру грузить что-либо со стороны.
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

// Порядок важен: index.html собирается первым, от него зависит отчёт
const PAGES = ['index.html', '404.html'];
const STATIC_FILES = ['robots.txt', 'sitemap.xml', 'site.webmanifest'];

const kb = (bytes) => (bytes / 1024).toFixed(1);

const sha256 = (text) =>
	createHash('sha256').update(text, 'utf8').digest('base64');

const INLINE_STYLE = /<style>([\s\S]*?)<\/style>/g;
const INLINE_SCRIPT =
	/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g;

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
		// без этого ломается любой same-origin fetch из страницы
		"connect-src 'self'",
		"base-uri 'none'",
		"form-action 'none'",
	];

	const meta = `<meta http-equiv="Content-Security-Policy" content="${policy.join('; ')}" />`;

	// CSP должен стоять до любых загрузок — сразу после charset
	return html.replace(/(<meta charset="utf-8" \/>)/, `$1\n\t\t${meta}`);
}

async function build() {
	await rm(DIST, { recursive: true, force: true });
	await mkdir(path.join(DIST, 'images'), { recursive: true });

	for (const file of PAGES) {
		const html = await readFile(file, 'utf8');
		await writeFile(path.join(DIST, file), injectCsp(html), 'utf8');
	}

	for (const file of STATIC_FILES) {
		await cp(file, path.join(DIST, file));
	}

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
	await report(imageBytes);
}

/**
 * Страховка от опечатки в пути: каждая картинка из index.html
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

async function report(imageBytes) {
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
	const htmlSize =
		files.find((file) => file.full.endsWith('index.html'))?.size ?? 0;

	console.log(`dist/ собран: ${files.length} файлов, ${kb(total)} КБ`);
	console.log(`  index.html — ${kb(htmlSize)} КБ`);
	console.log(`  картинки   — ${kb(imageBytes)} КБ`);
}

await build();
