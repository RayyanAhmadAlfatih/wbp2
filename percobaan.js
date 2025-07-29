const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const https = require('https');

const client = new Client();

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('✅ Client sudah siap, Rayyan!');

    // Buat folder 'fotos' jika belum ada
const folderPath = path.join(__dirname, 'fotos');
if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
}

    const groupId = '120363043803507465@g.us';

    try {
        const groupChat = await client.getChatById(groupId);
        const participants = groupChat.participants;

        console.log(`📊 Jumlah member: ${participants.length}`);
        const allContacts = [];

        for (const participant of participants) {
            const contact = await client.getContactById(participant.id._serialized);
            const profilePicUrl = await contact.getProfilePicUrl();
            const status = await contact.getAbout(); // Deskripsi (bio)
            const name = contact.name || contact.pushname || 'Tidak diketahui';
            const number = contact.number;

            console.log('---');
            console.log(`📞 Nomor: ${number}`);
            console.log(`👤 Nama: ${name}`);
            console.log(`📝 Status: ${status}`);
            console.log(`🖼️ Foto: ${profilePicUrl}`);

            // Simpan data
            allContacts.push({ number, name, status, profilePicUrl });

            // Simpan foto jika ada
            if (profilePicUrl) {
                const fileName = `${number}.jpg`;
                const file = fs.createWriteStream(path.join(__dirname, 'fotos', fileName));
                https.get(profilePicUrl, response => {
                    response.pipe(file);
                    console.log(`📥 Foto ${number} disimpan`);
                });
            }
        }

        // Simpan semua data ke file JSON
        fs.writeFileSync('data-kontak.json', JSON.stringify(allContacts, null, 2));
        console.log('📦 Data kontak disimpan ke data-kontak.json');

    } catch (err) {
        console.error('❌ Gagal ambil data kontak:', err);
    }
});

client.initialize();
