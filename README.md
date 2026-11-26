# IMAP Organizer

Applicazione web multiutente per collegare caselle **IMAP**, sincronizzare i messaggi e organizzarli in cartelle con **classificazione assistita da AI** (Pi coding agent).

Pensato per sviluppatori, pubbliche amministrazioni che vogliono clonare, configurare e far girare lo stack in locale.

## Cosa fa

- Login multiutente (niente registrazione pubblica: crea gli utenti un `super_admin`)
- Gestione caselle IMAP (test connessione, sync, classifica)
- Sync posta → MongoDB; dopo ogni sync parte automaticamente la classificazione
- Cartelle utente + cartelle `system` create dal classificatore
- Vista organizzazione (filtri cartella, drag & drop tra categorie, popup messaggio)
- Con `IMAP_WRITE_ENABLED=true`: elimina, crea cartelle e sposta messaggi anche sul server IMAP (non solo Mongo)

L’interfaccia **non** salva credenziali o posta in `localStorage`: parla solo con l’API.


## Stack

| Pacchetto | Ruolo |
|-----------|--------|
| `apps/web` | Next.js (UI) |
| `apps/api` | Fastify (auth, IMAP, job, cron, Pi) |
| `packages/shared` | DTO / tipi TypeScript condivisi |
| `apps/pi` | Credenziali Pi (`auth.json`, non versionato) |

Database: **MongoDB**, collection con prefisso `tbl_*` (es. `tbl_users`, `tbl_mailboxes`, `tbl_messages`, `tbl_folders`, `tbl_jobs`).

```
Browser  →  apps/web (:3000)  →  HTTP  →  apps/api (:4000)
                                           ├→ MongoDB
                                           ├→ IMAP
                                           └→ Pi agent (apps/pi/auth.json)
```

## Requisiti

- **Node.js** ≥ 22.19
- **npm** (workspaces)
- **MongoDB** raggiungibile (default `127.0.0.1:27017`, DB `email_organizer`)
- Credenziali provider LLM per Pi (file `apps/pi/auth.json`)

## Installazione

Dalla root del repository:

```bash
git clone https://github.com/DevForgeIT/imapOrganizer.git
cd imapOrganizer

npm install
npm run build -w @imap-organizer/shared
```

### Configurazione API

```bash
cp apps/api/.env.example apps/api/.env
```

Modifica `apps/api/.env`:

| Variabile | Descrizione |
|-----------|-------------|
| `PORT` | Porta API (default `4000`) |
| `MONGODB_URI` | Connection string Mongo |
| `JWT_SECRET` | Segreto JWT (≥ 16 caratteri) |
| `IMAP_SECRET` | Chiave AES per password IMAP (32 byte hex o stringa ≥ 32) |
| `WEB_ORIGIN` | Origine UI per CORS/cookie (`http://localhost:3000`) |
| `PI_AUTH_PATH` | Path a `auth.json` Pi (default relativo: `../pi/auth.json`) |
| `CRON_INTERVAL_MS` | Intervallo cron sync/classify (default `300000`) |
| `IMAP_WRITE_ENABLED` | `true` = scrittura IMAP (delete, create cartelle, MOVE messaggi) |
| `COOKIE_NAME` | Nome cookie sessione (default `io_session`) |

### Configurazione Web

```bash
cp apps/web/.env.example apps/web/.env.local
```

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
```

### Credenziali Pi (classificazione)

```bash
cp apps/pi/auth.example apps/pi/auth.json
```

Compila `apps/pi/auth.json` con i token del provider usato da `@earendil-works/pi-coding-agent`.  
**Non committare** questo file (è in `.gitignore`).

### Inizializza il database (super admin)

Con MongoDB avviato e `apps/api/.env` configurato, dalla **root** del repo:

```bash
npm run init-db
```

Lo script genera d’ufficio il primo `super_admin` (credenziali fisse di default):

| Campo | Valore |
|-------|--------|
| Email | `admin@imap-organizer.local` |
| Password | `Password1!` |

1. si connette a MongoDB e crea gli indici  
2. crea (o aggiorna) l’admin in `tbl_users`  
3. stampa le credenziali di login  

Idempotente: rieseguirlo ripristina email/ruolo/password di default dell’admin ufficiale.  
Dopo il primo accesso conviene cambiare la password dall’interfaccia admin.

## Docker (API + Web)

MongoDB **non** è incluso nel compose: deve essere già installato e raggiungibile (host o remoto).

### Procedura creazione container

**1. Prerequisiti**

- Docker Desktop (Windows/Mac) oppure Docker Engine + Compose (Linux)
- MongoDB attivo (es. su `localhost:27017`, database `email_organizer`)
- Repository clonato in locale

**2. Credenziali Pi**

```bash
cp apps/pi/auth.example apps/pi/auth.json
# modifica apps/pi/auth.json con i token del provider LLM
```

Senza questo file il mount del container `api` fallisce.

**3. Variabili d’ambiente (opzionale ma consigliato)**

Crea un file `.env` nella **root** del progetto:

```env
MONGODB_URI=mongodb://host.docker.internal:27017/email_organizer
JWT_SECRET=change-me-long-random-secret
IMAP_SECRET=0123456789abcdef0123456789abcdef
WEB_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:4000
IMAP_WRITE_ENABLED=true
```

Note:
- Su **Windows/Mac** (Docker Desktop) `host.docker.internal` punta al Mongo sul PC host.
- Su **Linux**, se non funziona, metti l’IP del host o la URI Mongo remota in `MONGODB_URI`.
- `NEXT_PUBLIC_API_URL` viene “baked” in **build** dell’immagine web: se la cambi, rifai il build di `web`.

**4. Build delle immagini**

Dalla root del repository:

```bash
docker compose build
```

Equivalente esplicito:

```bash
docker compose build api
docker compose build web
```

Dockerfile usati:
- `apps/api/Dockerfile` → immagine API
- `apps/web/Dockerfile` → immagine Web (Next.js standalone)

**5. Avvio dei container**

```bash
docker compose up -d
```

Oppure build + avvio in un colpo solo:

```bash
docker compose up -d --build
```

Verifica:

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f web
```

**6. Inizializza il super admin (una tantum)**

```bash
docker compose run --rm init-db
```

Login di default:
- URL: http://localhost:3000/login
- Email: `admin@imap-organizer.local`
- Password: `Password1!`

**7. URL servizi**

| Servizio | URL |
|----------|-----|
| Web | http://localhost:3000 |
| API | http://localhost:4000 |
| Health API | http://localhost:4000/health |

**8. Comandi utili**

```bash
# Stop
docker compose down

# Rebuild dopo modifiche al codice
docker compose up -d --build

# Solo rebuild web (es. dopo cambio NEXT_PUBLIC_API_URL)
docker compose build web
docker compose up -d web
```

## Avvio in sviluppo

Due terminali dalla root:

**API**

```bash
npm run dev:api
```

- API: http://localhost:4000  
- Health: http://localhost:4000/health  

**Web**

```bash
npm run dev:web
```

- UI: http://localhost:3000  

### Primo accesso

1. Esegui `npm run init-db` (vedi sopra)
2. Login: http://localhost:3000/login con le credenziali stampate dallo script
3. Crea altri utenti da http://localhost:3000/admin/users (solo `super_admin`)

La registrazione pubblica (`/register`) è disabilitata.

## Build di produzione

```bash
npm run build
```

Equivalente a build di `shared` → `api` → `web`.

Avvio API compilata (dopo build):

```bash
npm run start -w @imap-organizer/api
```

Per la web usa il comando di start Next del workspace `@imap-organizer/web` (o il tuo reverse proxy / process manager).

## Flusso operativo (smoke)

1. Login come `super_admin` → crea un utente
2. Login come utente → **Aggiungi casella** IMAP
3. **Test** connessione
4. **Sync + Classifica** (sync poi classifica in automatico)
5. Apri posta → cartelle / messaggi / drag & drop
6. (Opzionale) elimina messaggio dal popup (richiede `IMAP_WRITE_ENABLED=true`)

### Gmail

- Host: `imap.gmail.com`, porta `993`, TLS attivo
- Usa una **App Password** (16 caratteri), non la password dell’account Google

## Script utili (API)

Dalla **root** del repo:

```bash
# Bootstrap DB + super_admin (prima installazione / reset admin)
npm run init-db
```

Dalla cartella `apps/api`:

```bash
# Reset password di TUTTI gli utenti (default Password1!)
npx tsx scripts/reset-all-passwords.ts

# Password custom (Windows PowerShell)
$env:NEW_PASSWORD="MiaPassword1!"
npx tsx scripts/reset-all-passwords.ts

# Controllo conteggi organizzazione
npx tsx scripts/check-org.ts
```

## Test

```bash
npm run test:api
```

(Vitest sul package `@imap-organizer/api`.)

## Struttura repository

```
apps/
  api/          # Fastify: routes, IMAP, jobs, llm/classify
  web/          # Next.js App Router
  pi/           # auth.json (locale) + auth.example
packages/
  shared/       # Tipi condivisi
screen/         # Screenshot (documentazione)
publiccode.yml  # Metadati software (Developers Italia / cataloghi)
```

### Convenzioni importanti

- Collection Mongo: prefisso **`tbl_`**
- UI ↔ API: cookie JWT httpOnly + CORS su `WEB_ORIGIN`
- Job: coda in Mongo (`tbl_jobs`); loop polling in API
- **Sync** enqueue anche **classify**; in UI l’overlay mostra entrambe le fasi
- Classificatore: preferisce cartelle `source=user`, crea cartelle `system` se serve; non lascia messaggi “senza categoria” a regime

## Variabili d’ambiente — riepilogo file

| File | Scopo |
|------|--------|
| `apps/api/.env` | Runtime API (segreto, Mongo, IMAP write, Pi path) |
| `apps/web/.env.local` | `NEXT_PUBLIC_API_URL` |
| `apps/pi/auth.json` | Auth provider LLM per Pi |

## Licenza / metadati

Vedi `publiccode.yml` per nome, organizzazione, stato di sviluppo e descrizione catalogabile.

## Supporto sviluppatori

Issue e contributi sul repository GitHub del progetto. Per problemi di classificazione verifica prima che `apps/pi/auth.json` sia valido e che l’API logghi errori sui job `classify` in `tbl_jobs`.
