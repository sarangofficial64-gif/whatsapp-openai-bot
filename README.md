# WhatsApp OpenAI Bot

A personal WhatsApp assistant powered by OpenAI, built with [Baileys](https://baileys.wiki).
It connects to WhatsApp via a QR-linked device and **only replies to one whitelisted number**.

## How it works

- **Baileys** links to your WhatsApp account (like WhatsApp Web) — no Meta business approval needed.
- Incoming messages from the allowed number are sent to **OpenAI**, and the reply is sent back.
- Session/login is saved to disk so you don't re-scan the QR every restart.

## Features

- **To-do list** — natural language ("add buy milk", "mark 2 done") + `/list`. Daily 10:00 prompt.
- **Reminders** — one-off ("remind me in 15 min"/"tomorrow"/"on 25th May") and fixed daily pings
  (9:45 Keka login, 18:30 Keka logout). Unread reminders can escalate with a follow-up nudge after 5 min.
- **Voice notes** — transcribed and handled like a typed message.
- **Images** — described via vision, or answers questions about them.
- **Google Drive** — save files (direct, by reply, or via confirmation) and search/retrieve them later.
- **`/store` + semantic search (Neon + pgvector)** — save any text/link/photo/PDF/audio (including replies
  and voice-note transcripts) into a searchable knowledge base; ask "what did I save about X?" to recall it.
- **PDF extraction** via LlamaParse (OCR-capable), with local fallback.
- **Web search** via OpenAI's hosted search tool.
- **Persistent** — everything (todos, reminders, model choice) survives restarts.

## Commands

| Command | Effect |
|---|---|
| `/list` | Show your to-do list |
| `/store` | Save a message (reply to it), or `/store <text>` directly |
| `/model [name]` | Show or change the AI model, e.g. `/model gpt-4o` |
| `/driveauth` | Connect Google Drive |
| `/newchat` (or `/reset`) | Fresh conversation (to-dos/reminders/files kept) |
| `/ping` | Health check — replies `pong` |
| `/help` | Full list of everything the bot can do |

## Run locally

```bash
npm install
cp .env.example .env      # fill in the values — see Environment variables below
npm start
```

Scan the QR that prints in the terminal (WhatsApp → **Linked Devices** → **Link a device**).
Once you see `✅ WhatsApp connected`, message the bot from the allowed number.

## Deploy on Railway

1. Push this repo to GitHub (done).
2. On [Railway](https://railway.app): **New Project → Deploy from GitHub repo**.
3. Add a **Volume** (Service → Settings → Volumes), mount path `/data`.
4. Service → **Settings → Networking → Generate Domain** (needed for Google OAuth redirects).
5. Set **Variables** (Variables tab → Raw Editor lets you paste many at once) — see below.
6. In **Google Cloud Console** → your OAuth Client → **Authorized redirect URIs**, add
   `https://<your-railway-domain>/oauth2callback` (keep the localhost one too if you still test locally).
7. Deploy, open **Deploy Logs**, and scan the QR that appears there.
   > The volume keeps you logged in across future deploys — you only scan once.
   > If `DATABASE_URL` points at the same Neon project you already used locally, Google Drive
   > stays connected automatically (the refresh token lives in Neon, not on disk) — no need to
   > redo `/driveauth` unless you want a fresh connection.

## Deploy on Render (alternative)

Render works too, but a WhatsApp bot needs an always-on **Background Worker** +
a **Disk**, both of which require a **paid** plan. Render's free tier (Web
Services) sleeps after 15 min and has no persistent disk — not suitable here.

1. Dashboard → **New → Blueprint** → pick this repo (uses [`render.yaml`](render.yaml)).
2. Set the required variables in the dashboard.
3. Deploy, open **Logs**, and scan the QR.

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `OPENAI_API_KEY` | ✅ | — | platform.openai.com/api-keys |
| `ALLOWED_NUMBER` | ✅ | — | Digits + country code, e.g. `911234567890` |
| `AUTH_DIR` | On Railway | `./auth` | Set to `/data/auth` on the volume |
| `DATA_DIR` | On Railway | `./data` | Set to `/data/store` on the volume |
| `PUBLIC_URL` | On Railway | `http://localhost:PORT` | Your Railway public domain (for OAuth redirect) |
| `PORT` | — | `8080` | **Don't set on Railway** — it assigns this automatically |
| `OPENAI_MODEL` | — | `gpt-4o-mini` | Change live anytime with `/model` |
| `TRANSCRIBE_MODEL` | — | `whisper-1` | Voice note transcription |
| `SYSTEM_PROMPT` | — | (helpful assistant) | Bot personality |
| `HISTORY_LIMIT` | — | `12` | Messages of context kept |
| `LOG_LEVEL` | — | `warn` | `info`/`debug` for verbose logs |
| `DAILY_CRON` / `TIMEZONE` | — | `0 10 * * *` / `Asia/Kolkata` | Daily to-do prompt schedule |
| `KEKA_LOGIN_CRON` / `KEKA_LOGIN_MESSAGE` | — | `45 9 * * *` / ... | Daily reminder |
| `KEKA_LOGOUT_CRON` / `KEKA_LOGOUT_MESSAGE` | — | `30 18 * * *` / ... | Daily reminder (escalates if unread) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | For Drive | — | Google Cloud Console → OAuth Client (Web application) |
| `DATABASE_URL` | For `/store` | — | Neon Postgres connection string (pgvector) |
| `EMBEDDING_MODEL` | — | `text-embedding-3-small` | Used for semantic search |
| `LLAMA_CLOUD_API_KEY` | Optional | — | Better PDF extraction (OCR); falls back to local parsing |

## Notes / roadmap

- Baileys is an **unofficial** WhatsApp client. Use a number you don't mind risking; keep it personal, no spam.
- Ideas to grow: multi-user support, calendar sync, expense tracking, habit tracking, weekly digests.
