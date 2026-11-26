# Pi auth (local)

Credenziali del Pi coding-agent usate dall’API per la classificazione email.

## File

| File | Uso |
|------|-----|
| `auth.example` | Template (versionato) |
| `auth.json` | Credenziali reali (creato dall'utente) |

Copia e compila:

```bash
cp auth.example auth.json
```

## Path di default usato dall’API

Se `PI_AUTH_PATH` non è impostato, l’API risolve:

`<repo>/apps/pi/auth.json`

(relativo al codice in `apps/api/src/llm` → `../../../pi/auth.json`).

### Windows

```text
D:\xampp\htdocs\IMAPOrganizer\apps\pi\auth.json
```

(adatta il drive/cartella al tuo clone, es. `C:\Users\...\IMAPOrganizer\apps\pi\auth.json`)

### Linux / macOS

```text
/home/<utente>/IMAPOrganizer/apps/pi/auth.json
```

oppure, dal clone:

```text
<path-al-repo>/apps/pi/auth.json
```

## Override in `apps/api/.env`

Relativo alla working directory dell’API (di solito `apps/api`):

```env
PI_AUTH_PATH=../pi/auth.json
```

Assoluto **Windows**:

```env
PI_AUTH_PATH=<root>/IMAPOrganizer/apps/pi/auth.json
```

Assoluto **Linux**:

```env
PI_AUTH_PATH=/home/<utente>/IMAPOrganizer/apps/pi/auth.json
```

`auth.json` non va in git: contiene secret.
