TIMBRATURE + FLOTTA - VERSIONE PULITA PER RENDER

CREDENZIALI INIZIALI
Admin: admin@cantiere.local
Password: admin123

DEPLOY BACKEND SU RENDER
1) New -> Web Service
2) Repository: robertosca/timbrature-flotta oppure nuova repo caricata da questa ZIP
3) Root Directory: backend
4) Runtime/Language: Python
5) Build Command:
   pip install -r requirements.txt
6) Start Command:
   uvicorn app.main:app --host 0.0.0.0 --port $PORT
7) Environment Variable consigliata:
   FRONTEND_URL = https://flotta-frontend.onrender.com

DEPLOY FRONTEND SU RENDER
1) New -> Static Site
2) Root Directory: frontend
3) Build Command:
   npm install --legacy-peer-deps --registry=https://registry.npmjs.org && npm run build
4) Publish Directory:
   dist
5) Environment Variable:
   VITE_API_URL = https://timbrature-flotta.onrender.com
6) Redirect/Rewrites su Render:
   Source: /*
   Destination: /index.html
   Action: Rewrite

NOTE IMPORTANTI
- Questa ZIP NON contiene node_modules, .venv, .git, database locale o package-lock con registry interni.
- Se Render va in timeout durante npm install, usa: Clear build cache & deploy.
- Il backend gratuito Render può addormentarsi; la prima richiesta può richiedere 30-60 secondi.
