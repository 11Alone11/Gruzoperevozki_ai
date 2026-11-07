import js from '@eslint/js';

const sharedRules = {
	'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
	eqeqeq: ['error', 'always'],
	'no-var': 'error',
	'prefer-const': 'error',
	'no-console': 'off',
};

export default [
	{
		ignores: ['node_modules/**', 'images/**', 'server/data/**'],
	},

	js.configs.recommended,

	/* Браузерный код.
	   index.html содержит инлайновый <script>; scripts/lint-inline-script.mjs
	   извлекает его и передаёт в ESLint через --stdin с этим именем файла. */
	{
		files: ['inline-script-*.js'],
		languageOptions: {
			ecmaVersion: 2024,
			sourceType: 'script',
			globals: {
				window: 'readonly',
				document: 'readonly',
				location: 'readonly',
				history: 'readonly',
				fetch: 'readonly',
				FormData: 'readonly',
				URLSearchParams: 'readonly',
				requestAnimationFrame: 'readonly',
				cancelAnimationFrame: 'readonly',
			},
		},
		rules: sharedRules,
	},

	/* Node-код: служебные скрипты сборки и линта */
	{
		files: ['scripts/**/*.mjs', 'eslint.config.js'],
		languageOptions: {
			ecmaVersion: 2024,
			sourceType: 'module',
			globals: {
				process: 'readonly',
				console: 'readonly',
				Buffer: 'readonly',
				URL: 'readonly',
				URLSearchParams: 'readonly',
				fetch: 'readonly',
				setTimeout: 'readonly',
				setInterval: 'readonly',
				clearInterval: 'readonly',
			},
		},
		rules: sharedRules,
	},
];
