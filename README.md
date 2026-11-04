# 3️⃣ FF Backup Center — Telegram backup + Data Center + heavy jobs

Saare **heavy** kaam yahan: Telegram backup, full backup / restore, 12-type Data Center, Data Delete, monthly backup, unverified-signup cleanup.
Sab kuch **slow-mode (delay)** ke saath chalta hai taaki free server na atke.

## Panel mein
- **Home**: Telegram account (add / test / remove) · **Har mahine ka backup** (din + time, agla run kab, pichla result, Abhi chalao) · **Delay / Speed** (🚀 Turbo / ⚖️ Normal / 🐢 Slow / 🪨 Ultra — turant lagu, save rehta hai) · Auto full-backup schedule · Maintenance (cleanup) · Storage
- **Backup**: collections chuno → backup banao (+ Telegram), download / restore / delete, file upload se restore
- **Data**: 12 types — download, upload, purana delete (pehle Telegram backup), auto-delete schedule
- **Delete**: collection / purana data / single doc — PIN + auto-backup ke saath
- **Maintenance** (Home): unverified-signup cleanup + **Chat messages 24h cleanup** (user app mein messages 24 ghante baad hat jate hain; yeh job chat database se expired messages delete karti hai, har 12 ghante)
- Top strip: Render · UptimeRobot · Self revive

## Monthly backup aur sleep
Free plan par service so sakti hai. Isliye monthly backup **catch-up** karta hai: tay din/time par chalta hai, aur agar service tab so rahi thi to jaagte hi usi mahine mein chal jaata hai. Pehli baar schedule on karne par surprise backup nahi chalta.
Is service par `KEEPALIVE=false` default hai (hours bachane ke liye). Agar monthly backup ke din time par pakka chalana hai to UptimeRobot monitor lagao (5 min) ya `KEEPALIVE=true` karo.

## Telegram
my.telegram.org se API ID / Hash + Telethon StringSession (panel ke Telegram dialog mein code diya hai). Credentials Firestore mein save hote hain, Render env mein nahi.

## Disk
Render free ka disk restart par saaf hota hai. Isliye backup Telegram par bhi jaata hai — zaroori backup download bhi kar lo. Paid Disk ho to `BACKUP_DIR=/var/data/backups`.

## Render par deploy (Docker)
1. Is folder ko apni **alag GitHub repo** mein daalo (ya ek repo mein 3 folder rakho aur Render mein *Root Directory* set karo).
2. Render → **New → Blueprint** (ya New → Web Service → Runtime **Docker**) → repo choose karo. `render.yaml` sab bhar deta hai.
3. **Environment** mein `.env.example` ke hisaab se values bharo. Firebase key ke liye: `python tools/make_b64.py serviceAccount.json` ka output `FIREBASE_CREDENTIALS_B64` mein paste.
4. Deploy ke baad `https://<service>.onrender.com/health` kholo — `{"ok":true}` aana chahiye.
5. UptimeRobot: **Add New Monitor → HTTP(s)** → URL `https://<service>.onrender.com/health` → interval **5 min**.
   Phir UptimeRobot → My Settings → API → **Read-only API key** → env `UPTIMEROBOT_API_KEY`. Ab panel ke top strip mein uptime % dikhega.
6. Panel ke header mein **server icon** dabao — Render status, UptimeRobot, Self-revive aur env check ek jagah.
