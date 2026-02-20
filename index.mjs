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
        // Returns the high-res original image if available
        return data.originalimage ? data.originalimage.source : null;
    } catch (e) { 
        console.log("Could not find Wiki image for:", authorName);
        return null; 
    }
}

async function postToDiscord(quoteData) {
    const authorImg = await getAuthorImage(quoteData.author);
    const discordPayload = {
        username: "Quote of the Day",
        embeds: [{
            // No title or date per your request
            description: `## **"${quoteData.quote}"**\n\n— ***${quoteData.author}***\n\n**The Meaning**\n${quoteData.context}\n\n🔗 [Learn more about ${quoteData.author}](${quoteData.sourceUrl})`,
            color: 0xf1c40f,
            image: { url: authorImg }
        }]
    };
    await fetch(CONFIG.DISCORD_URL, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(discordPayload) 
    });
}

async function main() {
    // Check if we already posted today to prevent double-spending API credits
    if (fs.existsSync(CONFIG.SAVE_FILE)) {
        try {
            const saved = JSON.parse(fs.readFileSync(CONFIG.SAVE_FILE, 'utf8'));
            if (saved.generatedDate === today) {
                console.log("Already generated for today. Posting saved content...");
                await postToDiscord(saved);
                return;
            }
        } catch (e) { console.log("Starting fresh..."); }
    }

    let historyData = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try { historyData = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8')); } catch (e) {}
    }
    const usedAuthors = historyData.map(h => h.author.toLowerCase());

    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
    
    // Using the 2.0-flash alias to ensure v1 endpoint compatibility and avoid 404
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    const prompt = `Provide a powerful, famous quote. JSON ONLY: {"quote": "text", "author": "Full Name", "sourceUrl": "Wikipedia URL", "context": "1 sentence on why it matters"}. DO NOT use these authors: ${usedAuthors.join(", ")}`;
    
    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, "").trim();
        const quoteData = JSON.parse(text);

        if (quoteData) {
            quoteData.generatedDate = today;
            fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(quoteData));
            
            historyData.unshift(quoteData); 
            // Keep history to last 30 entries
            fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData.slice(0, 30), null, 2));
            
            await postToDiscord(quoteData);
            console.log("Success! Quote posted to Discord.");
        }
    } catch (error) {
        console.error("API Error:", error.message);
        process.exit(1);
    }
}

main();
