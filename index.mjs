import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_quote.txt',
    HISTORY_FILE: 'quote_history.json'
};

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Los_Angeles' });

async function getAuthorImage(authorName) {
    try {
        const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(authorName)}`;
        const response = await fetch(wikiUrl);
        const data = await response.json();
        return data.originalimage ? data.originalimage.source : null;
    } catch (e) { return null; }
}

async function postToDiscord(quoteData) {
    const authorImg = await getAuthorImage(quoteData.author);
    const discordPayload = {
        username: "Quote of the Day",
        embeds: [{
            description: `## **"${quoteData.quote}"**\n\n— ***${quoteData.author}***\n\n**The Meaning**\n${quoteData.context}\n\n🔗 [Learn more about ${quoteData.author}](${quoteData.sourceUrl})`,
            color: 0xf1c40f,
            image: { url: authorImg }
        }]
    };
    await fetch(CONFIG.DISCORD_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(discordPayload) });
}

async function main() {
    if (fs.existsSync(CONFIG.SAVE_FILE)) {
        try {
            const saved = JSON.parse(fs.readFileSync(CONFIG.SAVE_FILE, 'utf8'));
            if (saved.generatedDate === today) {
                await postToDiscord(saved);
                return;
            }
        } catch (e) {}
    }

    let historyData = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try { historyData = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8')); } catch (e) {}
    }
    const usedAuthors = historyData.map(h => h.author.toLowerCase());

    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
    // STABLE 2026 PREVIEW NAME
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
    
    const prompt = `Provide a powerful, attributed quote. JSON ONLY: {"quote": "text", "author": "Full Name", "sourceUrl": "URL", "context": "1 sentence impact"}. DO NOT use: ${usedAuthors.join(", ")}`;
    
    const result = await model.generateContent(prompt);
    const quoteData = JSON.parse(result.response.text().replace(/```json|```/g, "").trim());

    if (quoteData) {
        quoteData.generatedDate = today;
        fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(quoteData));
        historyData.unshift(quoteData); 
        fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData, null, 2));
        await postToDiscord(quoteData);
    }
}
main();
