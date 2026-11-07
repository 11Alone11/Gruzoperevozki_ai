#!/usr/bin/env bash
#
# Меняет базовый адрес сайта во всех файлах, где он прописан:
# canonical, og:url, og:image, twitter:image, JSON-LD, robots.txt, sitemap.xml.
#
#   bash scripts/set-domain.sh borisov-loading.by
#   bash scripts/set-domain.sh https://borisov-loading.by
#
set -euo pipefail

OLD="https://11alone11.github.io/Gruzoperevozki_ai"

if [ $# -ne 1 ]; then
	echo "Использование: bash scripts/set-domain.sh <домен>" >&2
	echo "Пример:        bash scripts/set-domain.sh borisov-loading.by" >&2
	exit 1
fi

NEW="${1#http://}"
NEW="${NEW#https://}"
NEW="${NEW%/}"

if [ -z "$NEW" ]; then
	echo "Ошибка: пустой домен." >&2
	exit 1
fi

echo "Меняю $OLD -> https://$NEW"

grep -rl "$OLD" . \
	--exclude-dir=node_modules \
	--exclude-dir=.git \
	--exclude-dir=dist \
	| while read -r file; do
		perl -pi -e "s/\Q$OLD\E/https:\/\/$NEW/g" "$file"
		echo "  обновлён $file"
	done

echo
echo "Готово. Если сайт переезжает на свой домен, поменяйте также адрес"
echo "публикации в настройках репозитория (Settings → Pages → Custom domain)."
