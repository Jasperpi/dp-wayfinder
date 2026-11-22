# DP Wayfinder — Dos Pueblos High School Campus Navigator

An offline-first, phone-first, zero-backend campus wayfinder for **Dos Pueblos High School** (Goleta, CA).

- **Live App:** https://jasperpi.github.io/dp-wayfinder/
- **Printable Entrance QR Posters:** https://jasperpi.github.io/dp-wayfinder/posters.html

## Highlights
- **Conversational Voice + Camera Guide:** Speak naturally (*"I'm at the EPAC"*, *"room S four"*, *"engineering, 3rd period, he's a senior"*, *"I'm at the library and need to go to H-27"*) or snap any classroom door sign for 100% on-device OCR.
- **3-Mode Campus Map:** Switch between **3D Isometric** (106 extruded highlightable classrooms + buildings), flat **2D**, and the official **Printed Map** overlay, in **Warm Cream Day** or **Back-to-School Night Dark** themes.
- **Back-to-School Night "My Schedule":** Save Periods 1–5 once, share via URL (`?sched=...`), and tap **Next Class** to auto-chain room-to-room routes synced with the bell schedule.
- **Bilingual English / Español:** Full UI toggle, Spanish voice input & narration (`es-US`), Spanish campus keywords (*biblioteca, alberca, baño, salón, gimnasio*), and bilingual printable entrance QR posters.
- **100% Private & Offline:** Zero runtime npm dependencies, zero analytics, Service Worker precaching of every map asset, and strictly real-world lat/lng verified left/right landmark directions (no compass jargon).

## Local Development
```bash
npm install
npm test
npm run build
npm run preview -- --host
```
