import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_quote.txt',
    HISTORY_FILE: 'quote_history.json',
    PRIMARY_MODEL: "gemini-3-flash-preview",
    BACKUP_MODEL: "gemini-1.5-flash"
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
            // Description uses a blank line and a small link to match thumbnail height
            description: `**"${quoteData.quote}"**\n\n— *${quoteData.author}*\n\u200B\n[Learn more about the author](${quoteData.sourceUrl})`,
            color: 0xf1c40f,
            thumbnail: { url: authorImg }
        }]
    };
    
    await fetch(CONFIG.DISCORD_URL, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(discordPayload) 
    });
}

async function generateWithRetry(modelName, prompt, retries = 3) {
    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
    const model = genAI.getGenerativeModel({ model: modelName });

    for (let i = 0; i < retries; i++) {
        try {
            const result = await model.generateContent(prompt);
            return result.response.text().replace(/```json|```/g, "").trim();
        } catch (error) {
            if (error.message.includes("503") || error.message.includes("429")) {
                console.log(`Model ${modelName} busy. Retry ${i + 1}/${retries}...`);
                await new Promise(r => setTimeout(r, 5000));
            } else { throw error; }
        }
    }
    throw new Error("Retries exhausted.");
}

async function main() {
    // 1. Check if already posted
    if (fs.existsSync(CONFIG.SAVE_FILE)) {
        try {
            const saved = JSON.parse(fs.readFileSync(CONFIG.SAVE_FILE, 'utf8'));
            if (saved.generatedDate === today) {
                console.log("Already posted today.");
                return;
            }
        } catch (e) {}
    }

    // 2. Load History
    let historyData = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try { historyData = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8')); } catch (e) {}
    }
    const usedAuthors = historyData.slice(0, 20).map(h => h.author);

    // 3. Generate Quote
    const prompt = `Provide a famous quote. JSON ONLY: {"quote": "text", "author": "Name", "sourceUrl": "Wikipedia URL"}. DO NOT use: ${usedAuthors.join(", ")}`;
    
    let responseText;
    try {
        responseText = await generateWithRetry(CONFIG.PRIMARY_MODEL, prompt);
    } catch (e) {
        console.log("Switching to backup model...");
        responseText = await generateWithRetry(CONFIG.BACKUP_MODEL, prompt);
    }

    // 4. Save and Post
    try {
        const quoteData = JSON.parse(responseText);
        quoteData.generatedDate = today;
        
        fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(quoteData));
        historyData.unshift(quoteData);
        fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData.slice(0, 50), null, 2));
        
        await postToDiscord(quoteData);
        console.log("Successfully posted!");
    } catch (err) {
        console.error("Critical Error:", err.message);
        process.exit(1);
    }
}

main();
