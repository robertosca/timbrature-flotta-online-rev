# Timbrature Cantiere Pro + Flotta QR

Sistema web per timbrature geolocalizzate, gestione operai/cantieri e modulo autovetture aziendali con QR code, check-in/check-out, tracciamento GPS, rifornimenti e anomalie.

## Avvio locale

Backend:
```cmd
cd backend
py -m pip install -r requirements.txt
py -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend:
```cmd
cd frontend
npm install --legacy-peer-deps --registry=https://registry.npmjs.org
npm run dev
```

Apri `http://localhost:5173`.

Credenziali admin iniziali:
- email: `admin@cantiere.local`
- password: `admin123`

## Deploy Render

Leggi `README_RENDER.txt`.
