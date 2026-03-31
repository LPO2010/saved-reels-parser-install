# Saved Reels Parser (Public Install)

Эта инструкция рассчитана на:
- MacBook (macOS)
- Google Chrome

Это публичный установочный репозиторий.
Исходный код разработки хранится отдельно (private).

## Установка

1. Скачай репозиторий (`Code` -> `Download ZIP`) или сделай `git clone`.
2. Открой `chrome://extensions`.
3. Включи `Developer mode`.
4. Нажми `Load unpacked`.
5. Выбери папку этого репозитория (где лежит `manifest.json`).

## Использование

1. Открой Instagram и раздел `Saved`.
2. Открой popup расширения.
3. Нажми `Health` -> `Start`.
4. Дождись `stage: done`.
5. Нажми `Export CSV`.
6. Для приоритизации загрузи CSV сюда:
   - `https://lpo2010.github.io/saved-prioritizer-web/`

Результат:
- `saved_export_*.csv`
- `saved_export_failures_*.csv` (если были ошибки)
