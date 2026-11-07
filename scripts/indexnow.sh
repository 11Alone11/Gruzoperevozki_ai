#!/usr/bin/env bash
#
# Сообщает поисковикам (Bing, Yandex, Seznam) об изменениях на сайте —
# они индексируют страницу быстрее, чем ждут обхода по sitemap.
#
#   bash scripts/indexnow.sh
#
set -euo pipefail

HOST="11alone11.github.io"
KEY="gruzoperevozki-ai"
ORIGIN="https://${HOST}/Gruzoperevozki_ai"
PAGE="${ORIGIN}/"

response=$(
	curl -s -o /dev/null -w "%{http_code}" -X POST "https://api.indexnow.org/indexnow" \
		-H "Content-Type: application/json; charset=utf-8" \
		-d "{
			\"host\": \"${HOST}\",
			\"key\": \"${KEY}\",
			\"keyLocation\": \"${ORIGIN}/${KEY}.txt\",
			\"urlList\": [\"${PAGE}\"]
		}"
)

case "$response" in
	200|202) echo "Готово: поисковики приняли адрес (HTTP $response)." ;;
	422) echo "Ошибка 422: ключ не совпадает с файлом ${ORIGIN}/${KEY}.txt" >&2; exit 1 ;;
	403) echo "Ошибка 403: ключ не найден по адресу keyLocation." >&2; exit 1 ;;
	*) echo "Неожиданный ответ: HTTP $response" >&2; exit 1 ;;
esac
