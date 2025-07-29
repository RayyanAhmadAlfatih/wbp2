const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// JSON data path
const sarKeywordsPath = path.join(__dirname, '../data/sar_keywords.json');

function loadKeywords() {
    if (!fs.existsSync(sarKeywordsPath)) {
        fs.writeFileSync(sarKeywordsPath, JSON.stringify([]));
    }
    return JSON.parse(fs.readFileSync(sarKeywordsPath));
}

function saveKeywords(data) {
    fs.writeFileSync(sarKeywordsPath, JSON.stringify(data, null, 2));
}

router.get('/keywords', (req, res) => {
    const keywords = loadKeywords();
    res.json({ success: true, data: keywords });
});

router.post('/keywords', (req, res) => {
    const { keyword, response } = req.body;
    if (!keyword || !response) return res.status(400).json({ success: false, message: 'Keyword dan response wajib diisi.' });

    const keywords = loadKeywords();
    const id = Date.now();
    keywords.push({ id, keyword, response });
    saveKeywords(keywords);

    res.json({ success: true, message: 'Keyword ditambahkan.', id });
});

router.delete('/keywords/:id', (req, res) => {
    const { id } = req.params;
    let keywords = loadKeywords();
    keywords = keywords.filter(k => k.id != id);
    saveKeywords(keywords);

    res.json({ success: true, message: 'Keyword dihapus.' });
});

router.post('/check-message', async (req, res) => {
    const { from, message } = req.body;
    const keywords = loadKeywords();

    const matched = keywords.find(k => message.toLowerCase().includes(k.keyword.toLowerCase()));
    if (matched) {
        const { client } = require('../whatsapp');
        try {
            await client.sendMessage(from, matched.response);
            return res.json({ success: true, message: 'Balasan dikirim.' });
        } catch (e) {
            return res.status(500).json({ success: false, message: 'Gagal kirim balasan.' });
        }
    }

    res.json({ success: false, message: 'Tidak ada keyword cocok.' });
});

module.exports = router; // ✅ Ini cukup
