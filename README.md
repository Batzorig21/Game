# ♠ Multiplayer Poker — Texas Hold'em

Найзуудтайгаа онлайн Texas Hold'em Poker тоглоорой!

## Суулгах & Ажиллуулах

```bash
# 1. Суулгах
npm install

# 2. Эхлүүлэх
npm start

# 3. Браузерт нээх
http://localhost:3000
```

## Хэрхэн тоглох вэ?

1. **Өрөө үүсгэх**: Нэрээ оруулаад "Өрөө үүсгэх" дарна
2. **Код хуваалцах**: 5 үсгийн кодоо найздаа илгээ
3. **Найз нэгдэх**: Найз чинь нэрээ оруулаад, кодоор нэгдэнэ
4. **Тоглоом эхлүүлэх**: 2-6 тоглогч байхад эхлүүлж болно

## Тоглоомын дүрэм

- Texas Hold'em — 5 нийтийн карт (flop 3, turn 1, river 1)
- Blind: Small 10, Big 20
- Эхний chip: ₮1,000
- Call, Check, Raise, All-In, Fold

## Байршуулах (Deployment)

### Railway (үнэгүй):
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

### Render.com:
- GitHub-т оруулаад Render дээр "Web Service" үүсгэнэ
- Start command: `node server.js`

## Технологи
- **Frontend**: HTML/CSS/JavaScript
- **Backend**: Node.js + Express
- **Realtime**: Socket.IO (WebSocket)
