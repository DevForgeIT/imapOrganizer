# Pi auth (local)

Put Pi coding-agent credentials here:

- `auth.json` — required for email classification

Default path used by the API:

`apps/pi/auth.json`

Optional override in `apps/api/.env`:

```
PI_AUTH_PATH=D:/xampp/htdocs/IMAPOrganizer/apps/pi/auth.json
```

`auth.json` is gitignored. Do not commit secrets.
