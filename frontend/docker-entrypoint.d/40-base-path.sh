#!/bin/sh
# Bake BASE_PATH into the nginx config and index.html at container start.
# Unset/empty BASE_PATH means "serve from the root" (local runs, tests).
set -e

BASE="${BASE_PATH:-}"
if [ -n "$BASE" ]; then
    BASE="/$(printf '%s' "$BASE" | sed 's|^/*||; s|/*$||')"
fi

if [ -n "$BASE" ]; then
    REDIRECT="    location = ${BASE} { return 301 ${BASE}/; }"
    ROOT="    location / { return 404; }"
else
    REDIRECT=""
    ROOT=""
fi

esc() { printf '%s' "$1" | sed 's/[&|]/\&/g'; }

sed -e "s|%%REDIRECT_BLOCK%%|$(esc "$REDIRECT")|g" \
    -e "s|%%ROOT_BLOCK%%|$(esc "$ROOT")|g" \
    -e "s|%%BASE_PATH%%|$(esc "$BASE")|g" \
    /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

sed "s|%%BASE_PATH%%|$(esc "$BASE")|g" \
    /usr/share/nginx/html/index.html.tpl > /usr/share/nginx/html/index.html

echo "base-path: serving app under '${BASE:-/}'"
