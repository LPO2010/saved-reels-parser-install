# Saved Reels Parser: parser-only инструкция (без web)

Эта инструкция только про Chrome extension:
- парсинг Saved в Instagram
- экспорт в CSV

Блок `web/` здесь не используется.

## 1) Что нужно заранее

- Google Chrome или Chromium
- Аккаунт Instagram с доступом к `Saved`
- Логин в Instagram в том же браузере, где запущен extension

## 2) Скачать проект

### Вариант A: через git

```bash
git clone https://github.com/<owner>/<repo>.git
cd <repo>
```

### Вариант B: zip

1. На GitHub нажми `Code` -> `Download ZIP`
2. Распакуй архив в любую папку

## 3) Установить extension локально

1. Открой `chrome://extensions`
2. Включи `Developer mode` (переключатель справа сверху)
3. Нажми `Load unpacked`
4. Выбери папку проекта (ту, где лежит `manifest.json`)

Если всё ок, увидишь extension `Saved Reels Parser MVP`.

## 4) Запуск парсера

1. Открой `https://www.instagram.com/`
2. Перейди в `Saved` (страница с сохраненными постами/рилсами)
3. Нажми иконку extension
4. В popup нажми `Start`
5. Дождись завершения:
   - `stage: done`
   - `running: false`
6. Нажми `Export CSV`

## 5) Что выгружается

- Основной файл: `saved_export_<timestamp>.csv`
- Если были ошибки при догрузке деталей: `saved_export_failures_<timestamp>.csv`

Обычно Chrome предлагает выбрать путь для основного CSV (`saveAs: true`).

## 6) Как читать статус в popup

- `stage`
  - `phase1_discovery` - сбор ссылок из сетки Saved
  - `phase2_enrichment` - догрузка метаданных по каждой ссылке
  - `done` - готово
  - `error` - критическая ошибка
- `discovered` - сколько найдено ссылок
- `processed` - сколько уже обработано во второй фазе
- `failed` - сколько ушло в fail CSV

## 7) Быстрый troubleshooting

### Ошибка: "Открой Instagram tab"

Причина: popup открыт, но активная вкладка не Instagram.  
Решение: сделай активной вкладку с `instagram.com`, потом нажми кнопку снова.

### Export вернул `no_records`

Причина: данные еще не собраны или парсер не запускался на странице Saved.  
Решение:
1. Открой именно страницу `Saved`
2. Нажми `Start`
3. Дождись `stage: done`
4. Повтори `Export CSV`

### Мало найденных постов или много fail

Причина: Instagram поменял DOM/селекторы или не успели прогрузиться элементы.  
Решение:
1. Прокрути страницу Saved немного вручную
2. Нажми `Health` и проверь, что `isSavedUrl: true`
3. Запусти `Start` повторно
4. Если проблема стабильная - обновить селекторы в коде

## 8) Ограничения parser-only режима

- Это DOM-only MVP, зависит от текущего UI Instagram
- Для больших коллекций лучше запускать сессиями, а не одной очень длинной сессией
