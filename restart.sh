git fetch
git reset --hard HEAD && git pull
# 1) Остановить и удалить контейнеры этого compose-проекта
docker compose down --remove-orphans
# 2) Пересобрать образы без кэша (и с обновлением базового образа)
docker compose build --no-cache --pull
# 3) Поднять заново
docker compose up -d
text="Проект bb-trade обновлен"
curl -X POST "https://dev.qwalex.ru/notify/" \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"$text\"}" \
  --fail \
  --show-error \
  --silent || echo "curl error"
