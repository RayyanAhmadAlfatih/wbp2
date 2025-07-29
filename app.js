// file: app.js
const express = require('express');
const fs = require('fs');
const cors = require('cors');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const axios = require('axios');

const app = express();
const PORT = 3000;

// ✨ Izinkan body "null" tanpa crash
app.use(express.json({ strict: false }));
app.use(cors({ origin: '*', methods: ['GET','POST','DELETE'], allowedHeaders: ['Content-Type'] }));

const qrStore     = {};  // { [deviceId]: qrString }
const statusStore = {};  // { [deviceId]: statusText }
const clients     = {};  // { [deviceId]: Client instance }

// Tangani JSON parse errors\ napp.use((err, req, res, next) => {
// Tangani JSON parse errors
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    console.warn('[JSON PARSE ERROR]', err.message);
    req.body = {};
    return next();
  }
  next(err);
});


// === Load & save helpers ===
const LICENSE_FILE   = './licenses.json';
const FOLLOWUP_FILE  = './followups.json';
const BROADCAST_FILE = './broadcasts.json';

let licenses     = safeLoad(LICENSE_FILE);
let followUps    = safeLoad(FOLLOWUP_FILE);
let broadcastLogs= safeLoad(BROADCAST_FILE);

function safeLoad(path) {
  try {
    if (fs.existsSync(path)) {
      const data = JSON.parse(fs.readFileSync(path, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch(e) { console.error(`[LOAD ERROR] ${path}`, e); }
  return [];
}

const saveLicenses     = () => fs.writeFileSync(LICENSE_FILE,   JSON.stringify(licenses,     null, 2));
const saveFollowUps    = () => fs.writeFileSync(FOLLOWUP_FILE,  JSON.stringify(followUps,    null, 2));
const saveBroadcasts   = () => fs.writeFileSync(BROADCAST_FILE, JSON.stringify(broadcastLogs, null, 2));

// === WhatsApp client ===
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
      '--disable-gpu','--no-first-run','--no-zygote','--disable-extensions'
    ]
  }
});
let currentQR = '';
function initClient(deviceId) {
  if (clients[deviceId]) return clients[deviceId];

  const client = new Client({
    puppeteer: { headless: true },
    authStrategy: new LocalAuth({ dataPath: `./session-${deviceId}` })
  });
  clients[deviceId] = client;
  statusStore[deviceId] = '🔃 Memuat...';

  client.on('qr', qr => {
    qrStore[deviceId]     = qr;
    statusStore[deviceId] = '🔄 Menunggu Scan QR';
    console.log(`[${deviceId}] QR generated`);
  });

  client.on('ready', () => {
    statusStore[deviceId] = '🟢 Terhubung: ' + (client.info.pushname||deviceId);
    console.log(`[${deviceId}] Ready`);
  });

  client.on('auth_failure', () => {
    statusStore[deviceId] = '🔴 Gagal Autentikasi';
    console.log(`[${deviceId}] Auth failure`);
  });

  client.on('disconnected', reason => {
    statusStore[deviceId] = '🔴 Terputus';
    console.log(`[${deviceId}] Disconnected`, reason);
  });

  client.initialize();
  return client;
}

// Inisialisasi pertama untuk device "default"
initClient('default');
// === Utilities ===
const normalizePhone = phone => {
  const nums = phone.replace(/\D/g, '');
  return nums.startsWith('0') ? '62'+nums.slice(1) : (nums.startsWith('62') ? nums : nums);
};
const parseSpintax = text =>
  (text||'').replace(/\{([^{}]+)\}/g, (_, group) => {
    const parts = group.split('|');
    return parts[Math.floor(Math.random()*parts.length)] || '';
  });

// === License API ===
app.post('/api/check-license', (req, res) => {
  const { license_key, email } = req.body||{};
  const lic = licenses.find(l => l.license_key===license_key && l.email===email);
  res.json(lic ? { status:'valid', is_master:lic.is_master?1:0 } : { status:'invalid' });
});
app.get('/api/all-licenses', (_, res) => res.json({ success:true, data:licenses }));
app.post('/api/add-license', (req, res) => {
  const { email, is_master=0 } = req.body||{};
  if (!email) return res.status(400).json({ success:false, msg:'Email required' });
  const rand = () => Math.random().toString(36).substr(2,5).toUpperCase();
  const num  = () => Math.floor(10000+Math.random()*90000);
  const suffix = () => String.fromCharCode(65+Math.floor(Math.random()*26))+Math.floor(Math.random()*9);
  const key = `WBP-${rand()}-${num()}-${suffix()}`;
  if (licenses.some(l=>l.license_key===key)) return res.status(409).json({ success:false, msg:'Dup key' });
  const newLic={license_key:key,email,is_master:parseInt(is_master)?1:0};
  licenses.push(newLic); saveLicenses();
  console.log('[ADD LICENSE]',newLic);
  res.json({ success:true, license:newLic });
});
app.post('/api/delete-license', (req, res) => {
  const { license_key } = req.body||{};
  const idx = licenses.findIndex(l=>l.license_key===license_key);
  if (idx<0) return res.status(404).json({ success:false, msg:'Not found' });
  if (licenses[idx].is_master) return res.status(403).json({ success:false, msg:'Cannot delete master' });
  licenses.splice(idx,1); saveLicenses();
  console.log('[DELETE LICENSE]',license_key);
  res.json({ success:true });
});


app.get('/qr/:id', async (req, res) => {
  const id = req.params.id;              // ← tambahkan ini
  const qr = qrStore[id];
  if (!qr) {
    initClient(id);
    return res.status(404).json({ error: 'QR belum tersedia, coba lagi sebentar.' });
  }

  try {
    const imgBuffer = await QRCode.toBuffer(qr);
    res.type('png').send(imgBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal generate QR');
  }
});



// --- Endpoint Status per device ---
app.get('/status/:id', (req, res) => {
  const id = req.params.id;
  // jika belum ada, inisialisasi default
  if (!statusStore[id]) initClient(id);

  res.json({ status: statusStore[id] || 'Tidak Diketahui' });
});

// (Opsional) Endpoint untuk daftar semua device
app.get('/devices', (_, res) => {
  const list = Object.keys(clients).map(id => ({ id, status: statusStore[id] }));
  res.json(list);
});

// === Send Single ===
app.post('/send-message', async (req, res) => {
  try {
    const { phone, message, enable_followup=false, follow_ups=[], stop_keywords='' } = req.body||{};
    if (!phone||!message) return res.status(400).json({ success:false, msg:'Missing data' });
    const waId = normalizePhone(phone)+'@c.us';
    const text = parseSpintax(message);
    await client.sendMessage(waId, text);
    console.log('[SEND]',waId,text);

    if (enable_followup && Array.isArray(follow_ups)) {
      const now = Date.now();
      const stops = stop_keywords.split(',').map(s=>s.trim().toLowerCase());
      for (let fu of follow_ups) {
        const m = String(fu.delay||'').match(/^(\d+)([smhd])$/);
        if (m) {
          const ms = parseInt(m[1]) * {s:1e3,m:6e4,h:3.6e6,d:8.64e7}[m[2]];
          followUps.push({phone:waId,message:fu.message,time:now+ms,stop_keywords:stops});
        }
      }
      saveFollowUps();
    }
    res.json({ success:true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ success:false, msg:'Internal error' });
  }
});

// === Broadcast ===
app.post('/api/broadcast', async (req, res) => {
  console.log('📥 Received broadcast:', JSON.stringify(req.body, null, 2));

  try {
    const {
      numbers = [], message = '', media_url = '', send_method = 'caption',
      delay_enable = false, delay_value = 0, delay_unit = 's',
      enable_followup = false, follow_ups = [], stop_keywords = ''
    } = req.body || {};

    if (!Array.isArray(numbers) || !numbers.length || !message)
      return res.status(400).json({ success: false, msg: 'Invalid numbers or message' });

    const delayMs = delay_enable ? delay_value * { s: 1e3, m: 6e4, h: 3.6e6, d: 8.64e7 }[delay_unit] : 0;
    const stops = stop_keywords.split(',').map(s => s.trim().toLowerCase());
    const now = Date.now();
    const randomNames = ['Customer', 'Bapak/Ibu/Kak'];

    for (let item of numbers) {
      let rawPhone = '';
      let name = '';

      if (typeof item === 'string') {
        if (item.includes(':')) {
          const [num, nm] = item.split(':');
          rawPhone = num.replace(/\D/g, '');
          name = nm ? nm.trim() : '';
        } else {
          rawPhone = item.replace(/\D/g, '');
        }
      } else if (typeof item === 'object' && item.phone) {
        rawPhone = String(item.phone).replace(/\D/g, '');
        name = item.name ? String(item.name).trim() : '';
      }

      if (!rawPhone) {
        console.warn('[SKIP] Invalid empty phone number in broadcast input:', item);
        continue;
      }

      const waId = normalizePhone(rawPhone) + '@c.us';
      const finalName = name || randomNames[Math.floor(Math.random() * randomNames.length)];
      const replaced = message.replace(/\{N\}/gi, finalName);
      const text = parseSpintax(replaced);

      console.log(`[BROADCAST DEBUG] Final Name: ${finalName}`);
      console.log(`[BROADCAST DEBUG] Final Message: ${text}`);


      try {
        if (media_url) {
          const resp = await axios.get(media_url, { responseType: 'arraybuffer' });
          const mime = resp.headers['content-type'];
          const b64 = Buffer.from(resp.data).toString('base64');
          const filename = media_url.split('/').pop();
          const media = new MessageMedia(mime, b64, filename);

          if (send_method === 'caption') {
            await client.sendMessage(waId, media, { caption: text });
            console.log('[BROADCAST] (caption)', waId, '->', text);
          } else {
            await client.sendMessage(waId, text);
            await client.sendMessage(waId, media);
            console.log('[BROADCAST] (separate)', waId, '->', text);
          }
        } else {
          await client.sendMessage(waId, text);
          console.log('[BROADCAST] (text only)', waId, '->', text);
        }

        broadcastLogs.push({
          phone: rawPhone,
          name: finalName,
          message: text,
          media_url,
          sent_at: new Date().toISOString()
        });

        if (enable_followup && Array.isArray(follow_ups)) {
          for (let fu of follow_ups) {
            const m = String(fu.delay || '').match(/^(\d+)([smhd])$/);
            if (m) {
              const ms = parseInt(m[1]) * { s: 1e3, m: 6e4, h: 3.6e6, d: 8.64e7 }[m[2]];
              followUps.push({
                phone: waId,
                message: fu.message,
                time: now + ms,
                stop_keywords: stops
              });
            }
          }
        }

      } catch (err) {
        console.error('[ERROR BROADCAST]', waId, err.message || err);
      }

      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    }

    saveBroadcasts();
    saveFollowUps();
    res.json({ success: true });

  } catch (e) {
    console.error('[BROADCAST ERROR]', e.message || e);
    res.status(500).json({ success: false, msg: 'Internal error' });
  }
});




// === Follow-up cron ===
setInterval(()=>{
  const now = Date.now();
  followUps = followUps.filter(fu=>{
    if (fu.time <= now) {
      client.sendMessage(fu.phone, parseSpintax(fu.message))
        .then(()=>console.log('[FOLLOW-UP]',fu.phone))
        .catch(e=>console.error(e));
      return false;
    }
    return true;
  });
  saveFollowUps();
},5000);

// === Stop keywords handler ===
// === Stop keywords handler (whole‑word, ignore punctuation) ===
client.on('message', async msg => {
  if (msg.from.endsWith('@g.us')) return;   // abaikan grup

  const from = msg.from;
  const text = msg.body.trim().toLowerCase();

  // Cek jika ada stop keyword yang cocok
  const stopCheck = followUps.filter(item => normalizePhone(item.phone) === normalizePhone(from));
  if (stopCheck.length > 0) {
    const matched = stopCheck.find(fu => {
      return fu.stop_keywords.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(text));
    });

    if (matched) {
      console.log(`[STOP DETECTED] Dari: ${from} → Stop keyword ditemukan!`);

      // Kirim update ke WP REST API
      try {
        await axios.post('https://example.com/wp-json/wa-sender/v1/leads-update', {
          phone: from,
          moveTo: "Follow up"
        });
        console.log(`[LEADS] Status updated ke Follow up untuk ${from}`);
      } catch (err) {
        console.error(`[LEADS ERROR] Gagal update lead di WordPress:`, err.message);
      }

      // Hapus dari follow up list biar gak dikirim lagi
      followUps = followUps.filter(fu => normalizePhone(fu.phone) !== normalizePhone(from));
      saveFollowUps();
      return;
    }
  }

  // Simpan ulang data follow up (jika tidak ada yang terhapus, tetap simpan)
  saveFollowUps();
});



// === Start server ===
app.listen(PORT, () => console.log(`[WBP] Server running on http://localhost:${PORT}`));
