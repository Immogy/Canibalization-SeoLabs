# SeoLabs kc-proxy (Vercel)

Rychlá read-only proxy pro CORS-safe stahování sitemap a HTML. Bez ukládání, bez logování obsahu.

## Deploy (Vercel)

1) Ve Vercel vytvořte nový projekt a jako zdroj vyberte složku `Documents/kc-proxy`.
2) Deploy bez build kroků (serverless functions).
3) Po nasazení budete mít endpoint:
   - `https://VAŠE-DOMÉNA.vercel.app/api/fetch?url={ENCODED_URL}`

## Použití v nástroji

Do pole „Proxy URL (pokročilé)“ vložte:

```
/api/fetch?url=
```

nebo absolutní URL vašeho nasazení.

## Bezpečnost

- Přidává CORS hlavičky `Access-Control-Allow-Origin: *`.
- Nepřidává cache, žádná data neukládá.
- User-Agent je generický.
