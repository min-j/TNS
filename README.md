# TNS — Trading Notification Service

Backend API that receives trade events from my automated Python trading bots,
tracks PnL, and delivers daily summaries via Discord.

## Stack

Node.js · Express · TypeScript · AWS Lambda · API Gateway ·
EventBridge · Neon PostgreSQL · Discord Webhooks · Serverless Framework

## How It Works

Trading bots POST trade events → backend stores and calculates PnL →
daily cron generates summaries → Discord notification

- Receives trade events from two bots with different strategies (intraday and swing)
- Calculates PnL for intraday trades, stores bot-reported PnL for swing positions
- Generates daily summaries via scheduled cron job
- Sends formatted Discord notifications with trade results and open position status
- Idempotent summary generation prevents duplicate notifications

## Running Locally

```
npm install
cp .env.example .env
npm run migrate
npm run dev
```

## Deploying

```
npm run build
npx serverless deploy
```

Requires AWS credentials configured. Environment variables are read from `.env` at deploy time.
