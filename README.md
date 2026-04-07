# CS2 Match Parser

Веб-приложение для загрузки итогового скриншота CS2, локального распознавания результата матча внутри сервиса и сохранения данных в PostgreSQL с привязкой к сезонам.

## Что умеет

- принимает JPG, PNG и WebP со скриншотом итогового табло CS2;
- определяет дату матча по времени загрузки;
- если загрузка произошла до `06:00` по `APP_TIMEZONE`, записывает матч предыдущим днем;
- запускает локальный OCR внутри сервиса через `tesseract`, без внешнего vision API;
- извлекает карту, итоговый счет, игроков по командам, убийства, смерти, урон и `%ГЛ`;
- формирует `KDA` в формате `Убийства/Смерти`;
- позволяет создать сезоны с диапазоном дат;
- умеет привязывать матч к сезону вручную или автоматически по дате матча;
- сохраняет матчи, команды, игроков и сезоны в PostgreSQL.

## Стек

- `Next.js 15`
- `Prisma`
- `PostgreSQL`
- локальный `tesseract-ocr`
- `nginx + systemd` для запуска на виртуальной машине

## Переменные окружения

Пример есть в [.env.example](/Users/akulaev/codex/.env.example).

Обязательные значения:

- `DATABASE_URL`
- `APP_TIMEZONE`
- `TESSERACT_BIN`
- `OCR_LANG`

Пример:

```env
DATABASE_URL="postgresql://cs2_user:strong_password@127.0.0.1:5432/cs2_stats?schema=public"
APP_TIMEZONE="Europe/Moscow"
TESSERACT_BIN="tesseract"
OCR_LANG="eng+rus"
```

## Локальный запуск

1. Установить зависимости:

```bash
cd /Users/akulaev/codex
npm install
```

2. Скопировать env:

```bash
cp .env.example .env
```

3. Поднять PostgreSQL и заполнить `DATABASE_URL`.

4. Применить миграции:

```bash
npx prisma migrate deploy
```

5. Запустить dev-сервер:

```bash
npm run dev
```

## Ручной деплой на виртуальную машину

Ниже пример для `Ubuntu 24.04`.

### 1. Подготовить сервер

Подключиться по SSH и установить системные пакеты:

```bash
sudo apt update
sudo apt install -y nginx postgresql postgresql-contrib tesseract-ocr tesseract-ocr-rus tesseract-ocr-eng git curl
```

Установить Node.js 22:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

### 2. Создать базу данных

```bash
sudo -u postgres psql
```

Внутри `psql`:

```sql
CREATE USER cs2_user WITH PASSWORD 'strong_password';
CREATE DATABASE cs2_stats OWNER cs2_user;
\q
```

### 3. Развернуть код

```bash
sudo mkdir -p /var/www/cs2-parser
sudo chown $USER:$USER /var/www/cs2-parser
git clone <URL_ВАШЕГО_РЕПОЗИТОРИЯ> /var/www/cs2-parser
cd /var/www/cs2-parser
npm install
```

### 4. Настроить `.env`

Создать файл:

```bash
cp .env.example .env
nano .env
```

Пример содержимого:

```env
DATABASE_URL="postgresql://cs2_user:strong_password@127.0.0.1:5432/cs2_stats?schema=public"
APP_TIMEZONE="Europe/Moscow"
TESSERACT_BIN="tesseract"
OCR_LANG="eng+rus"
```

### 5. Применить миграции и собрать приложение

```bash
npx prisma migrate deploy
npm run build
```

### 6. Запустить через systemd

Создать сервис:

```bash
sudo nano /etc/systemd/system/cs2-parser.service
```

Содержимое:

```ini
[Unit]
Description=CS2 Match Parser
After=network.target postgresql.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/var/www/cs2-parser
Environment=NODE_ENV=production
Environment=PORT=3000
EnvironmentFile=/var/www/cs2-parser/.env
ExecStart=/usr/bin/npm run start -- --hostname 127.0.0.1 --port 3000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Заменить `ubuntu` на вашего Linux-пользователя, если он другой.

Потом:

```bash
sudo systemctl daemon-reload
sudo systemctl enable cs2-parser
sudo systemctl start cs2-parser
sudo systemctl status cs2-parser
```

### 7. Настроить nginx

Создать конфиг:

```bash
sudo nano /etc/nginx/sites-available/cs2-parser
```

Содержимое:

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Активировать:

```bash
sudo ln -s /etc/nginx/sites-available/cs2-parser /etc/nginx/sites-enabled/cs2-parser
sudo nginx -t
sudo systemctl reload nginx
```

### 8. Обновление приложения

При новом релизе:

```bash
cd /var/www/cs2-parser
git pull
npm install
npx prisma migrate deploy
npm run build
sudo systemctl restart cs2-parser
```

## Сезоны

Сезон хранит:

- название;
- дату начала;
- дату окончания.

Логика привязки матча:

- если при загрузке выбран сезон, матч сохраняется в него;
- если сезон не выбран, приложение ищет сезон, в диапазон которого попадает дата матча;
- если подходящий сезон не найден, матч сохраняется без сезона.

## Ограничения текущего OCR

Локальный OCR работает полностью внутри сервиса, но качество распознавания все еще зависит от:

- качества исходного скриншота;
- размера текста;
- языка клиента CS2;
- шумов на фотографии экрана.

Для следующего улучшения имеет смысл добавить:

- предпросмотр распознанных данных перед сохранением;
- ручное редактирование результата OCR;
- сохранение сырого OCR-текста для отладки;
- предобработку изображения перед OCR.
