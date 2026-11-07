// Вырезает <script> из index.html и линтует через eslint --stdin.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const HTML_PATH = 'index.html';

// Берём только обычные <script>, пропуская JSON-LD и внешние подключения
const SCRIPT_PATTERN =
	/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g;

const html = readFileSync(HTML_PATH, 'utf8');
const scripts = [...html.matchAll(SCRIPT_PATTERN)]
	.map((match) => match[1].trim())
	.filter(Boolean);

if (scripts.length === 0) {
	console.log('В index.html нет инлайновых скриптов — нечего проверять.');
	process.exit(0);
}

let hasErrors = false;

scripts.forEach((code, index) => {
	const fileName = `inline-script-${index + 1}.js`;

	try {
		const report = execFileSync(
			'node',
			[
				'node_modules/eslint/bin/eslint.js',
				'--stdin',
				'--stdin-filename',
				fileName,
			],
			{ input: code, encoding: 'utf8' },
		);

		if (report.trim()) process.stdout.write(report);
		console.log(`✓ ${fileName} — без замечаний`);
	} catch (error) {
		hasErrors = true;

		if (error.stdout) process.stdout.write(error.stdout);
		if (error.stderr) process.stderr.write(error.stderr);
	}
});

process.exit(hasErrors ? 1 : 0);
