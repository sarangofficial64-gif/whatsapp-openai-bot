# WhatsApp OpenAI Bot

A personal WhatsApp assistant powered by OpenAI, built with [Baileys](https://baileys.wiki).
It connects to WhatsApp via a QR-linked device and **only replies to one whitelisted number**.

## How it works

- **Baileys** links to your WhatsApp account (like WhatsApp Web) — no Meta business approval needed.
- Incoming messages from the allowed number are sent to **OpenAI**, and the reply is sent back.
- Session/login is saved to disk so you don't re-scan the QR every restart.

## Features

- **Daily to-do prompt** — every day at 10:00 (IST by default) the bot asks what's
  on your list and reminds you of anything still pending.
- **Natural-language to-dos** — just say *"remind me to call the bank"*, *"what's on
  my list?"*, or *"mark 2 done"*. Powered by OpenAI tool-calling.
- **Persistent** — todos and your chosen model are saved to disk (Railway volume).

## Commands

| Command | Effect |
|---|---|
| `/list` | Show your to-do list |
| `/model [name]` | Show or change the AI model, e.g. `/model gpt-4o` |
| `/reset` | Clears conversation memory (to-dos are kept) |
| `/ping` | Health check — replies `pong` |
| `/help` | List commands |

## Run locally

```bash
npm install
cp .env.example .env      # then fill in OPENAI_API_KEY and ALLOWED_NUMBER
npm start
```

Scan the QR that prints in the terminal (WhatsApp → **Linked Devices** → **Link a device**).
Once you see `✅ WhatsApp connected`, message the bot from the allowed number.

## Deploy on Railway

1. Push this repo to GitHub (done).
2. On [Railway](https://railway.app): **New Project → Deploy from GitHub repo**.
3. Add a **Volume** (Service → Settings → Volumes), mount path e.g. `/data`.
4. Set **Variables** (see below), including `AUTH_DIR=/data/auth`.
5. Deploy, open the **Deploy Logs**, and scan the QR that appears there.
   > The volume keeps you logged in across future deploys.

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `OPENAI_API_KEY` | ✅ | — | From platform.openai.com |
| `ALLOWED_NUMBER` | ✅ | — | Digits + country code, e.g. `911234567890` |
| `AUTH_DIR` | On Railway | `./auth` | Set to `/data/auth` when using a volume |
| `DATA_DIR` | On Railway | `./data` | Todos/settings; set to `/data/store` on a volume |
| `OPENAI_MODEL` | — | `gpt-4o-mini` | Starting model (change live with `/model`) |
| `DAILY_CRON` | — | `0 10 * * *` | When to send the daily prompt |
| `TIMEZONE` | — | `Asia/Kolkata` | Timezone for the daily prompt |
| `SYSTEM_PROMPT` | — | (helpful assistant) | Bot personality |
| `HISTORY_LIMIT` | — | `12` | Messages of context kept |
| `LOG_LEVEL` | — | `warn` | `info`/`debug` for verbose logs |

## Notes / roadmap

- Baileys is an **unofficial** WhatsApp client. Use a number you don't mind risking; keep it personal, no spam.
- Conversation memory is in-RAM (resets on restart). Next step: move to a database.
- Ideas to grow: persistent history, image understanding, voice notes, multiple whitelisted users, tools/function-calling.
