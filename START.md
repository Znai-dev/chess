# Chess Online

Класичні шахи + три режими: лутбокси, туман війни, магічні шахи.
Опис режимів — у `mode_lootboxes.md`, `mode_fog_of_war.md`, `mode_magic_chess.md`.

## Як це працює в продакшені

```
git push → GitHub Actions: docker build → ghcr.io
                              ↓ (підписаний HMAC-запит)
                     deploy.mriiacraft.pp.ua
                              ↓
                сервер: docker compose pull + up -d
```

Нічого запускати вручну не треба: коміт у `main` за ~2 хвилини
опиняється на сервері. Збірка йде на процесорах GitHub, сервер лише
завантажує готові образи.

| | |
|---|---|
| Образи | `ghcr.io/znai-dev/chess-backend`, `ghcr.io/znai-dev/chess-frontend` |
| Сервер | `/srv/projects/chess/docker-compose.yml` |
| Маршрут | `/srv/caddy/sites/chess.caddy` |
| Логи деплою | `journalctl -u deploy-webhook -f` |

## Адреса

Гра живе не в корені домену, а на секретному шляху. Сам шлях у репозиторій
не потрапляє — він заданий лише на сервері:

- `/srv/projects/chess/.slug` — сам слаг
- `BASE_PATH` у `docker-compose.yml` — те, що бачить контейнер

Фронтенд дізнається свій префікс у рантаймі: `docker-entrypoint.d/40-base-path.sh`
підставляє його в `index.html` і в конфіг nginx при старті контейнера.
Порожній `BASE_PATH` означає «працюй від кореня» — саме так це поводиться
локально.

Щоб змінити адресу: відредагувати `BASE_PATH` у compose на сервері й
`docker compose up -d` — перезбірка не потрібна.

## Локальна розробка

```bash
cd backend  && npm install && npm run dev    # :3001
cd frontend && npm install && npm run dev    # :5173, проксі на бекенд
```

Vite віддає застосунок від кореня, префікс не застосовується.

## Перевірити збірку так, як її збирає CI

```bash
cd frontend && npm run build
cd backend  && npm run build
```
