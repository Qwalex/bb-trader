# Перенос приложения между VPS

Инструкция для скрипта `scripts/transfer-stack.sh`.

Скрипт переносит:

- код проекта (snapshot без `.git`, `node_modules`, `.next`, `dist`)
- `docker-compose` файл
- env-файлы (если существуют): `.env`, `.env.local`, `apps/api/.env`, `apps/api/.env.local`
- данные Docker volumes (включая SQLite volume)

## 1) Подготовка

На исходной и целевой VPS должны быть установлены:

- `docker` (с `docker compose`)
- `tar`
- `awk`
- `mktemp`
- `rsync`

Сделайте скрипт исполняемым:

```bash
chmod +x scripts/transfer-stack.sh
```

## 2) Backup на исходной VPS

Перейдите в корень проекта и выполните:

```bash
./scripts/transfer-stack.sh backup --output /tmp/signalsbot-transfer.tar.gz
```

Что делает команда:

- останавливает стек (`docker compose down`)
- архивирует проект и volumes
- создает итоговый архив `/tmp/signalsbot-transfer.tar.gz`

> Для SQLite рекомендуется **не** использовать `--no-stop`, чтобы не получить неконсистентный бэкап.

## 3) Копирование архива на новую VPS

Пример:

```bash
scp /tmp/signalsbot-transfer.tar.gz user@NEW_VPS:/tmp/
```

## 4) Restore на целевой VPS

```bash
./scripts/transfer-stack.sh restore \
  --bundle /tmp/signalsbot-transfer.tar.gz \
  --target-dir /opt/signalsBotProd
```

Что делает команда:

- разворачивает snapshot проекта в `--target-dir`
- восстанавливает env-файлы
- восстанавливает volumes
- запускает стек (`docker compose up -d`)

## 5) Частые варианты

### Перенос dev/test compose-файла

```bash
./scripts/transfer-stack.sh backup --compose-file docker-compose.dev.yml --output /tmp/dev-transfer.tar.gz
./scripts/transfer-stack.sh restore --compose-file docker-compose.dev.yml --bundle /tmp/dev-transfer.tar.gz --target-dir /opt/signalsBotProd-dev
```

или для test:

```bash
./scripts/transfer-stack.sh backup --compose-file docker-compose.test.yml --output /tmp/test-transfer.tar.gz
./scripts/transfer-stack.sh restore --compose-file docker-compose.test.yml --bundle /tmp/test-transfer.tar.gz --target-dir /opt/signalsBotProd-test
```

### Не запускать стек автоматически после restore

```bash
./scripts/transfer-stack.sh restore --bundle /tmp/signalsbot-transfer.tar.gz --target-dir /opt/signalsBotProd --no-start
```

### Задать фиксированное имя compose-проекта

```bash
./scripts/transfer-stack.sh restore --bundle /tmp/signalsbot-transfer.tar.gz --target-dir /opt/signalsBotProd --project-name signalsbot
```

## 6) Проверка после переноса

1. Проверьте контейнеры:

```bash
docker compose ps
```

2. Проверьте health API:

```bash
curl -sS http://127.0.0.1:3001/health
```

3. Откройте UI и убедитесь, что доступны:

- `/settings`
- `/logs`
- `/trades`

## 7) Troubleshooting

- **`Volume ... not found`**  
  Проверьте, что backup делался с нужным `--compose-file`.

- **`bundle file not found`**  
  Проверьте путь `--bundle` и права доступа.

- **После restore нет старых данных**  
  Обычно причина: восстановлен не тот архив/compose-file или другой project name.

- **Порт занят на новой VPS**  
  Измените порты в compose или остановите конфликтующие сервисы.

## 8) Важно про несколько VPS

Если приложение запущено на двух VPS одновременно, перед переносом выберите, какая БД является источником истины.  
Сливать две SQLite БД автоматически не рекомендуется.

