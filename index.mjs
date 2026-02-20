import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_quote.txt',
    HISTORY_FILE: 'quote_history.json',
    PRIMARY_MODEL: "gemini-3-flash-preview",
    BACKUP_MODEL: "gemini-2.5-flash-lite" // High-stability fallback
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
            // Streamlined description: Quote followed by italicized author
            description: `## **"${quoteData.quote}"**\n\n— *${quoteData.author}*\n\n🔗 [Learn more about the author](${quoteData.sourceUrl})`,
            color: 0xf1c40f,
            // Changed from 'image' to 'thumbnail' for the smaller side-profile look
            thumbnail: { 
                url: authorImg 
            }
        }]
    };
    
    const response = await fetch(CONFIG.DISCORD_URL, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(discordPayload) 
    });

    if (!response.ok) {
        console.error("Discord Post Failed:", await response.text());
    }
}

async function generateWithRetry(modelName, prompt, retries = 3) {
    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
    const model = genAI.getGenerativeModel({ model: modelName });

    for (let i = 0; i < retries; i++) {
        try {
            const result = await model.generateContent(prompt);
            return result.response.text().replace(/```json|```/g, "").trim();
        } catch (error) {
            if (error.message.includes("503") || error.message.includes("504")) {
                console.log(`Server busy (503). Retry ${i + 1}/${retries} in 5 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            } else {
                throw error;
            }
        }
    }
    throw new Error("All retries failed due to high demand.");
}

async function main() {
    // History & Duplicate Check logic (omitted for brevity, keep your current logic)
    let historyData = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try { historyData = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8')); } catch (e) {}
    }
    const usedAuthors = historyData.map(h => h.author.toLowerCase());

    const prompt = `Provide a powerful, famous quote. JSON ONLY: {"quote": "text", "author": "Full Name", "sourceUrl": "Wikipedia URL", "context": "1 sentence on why it matters"}. DO NOT use: ${usedAuthors.slice(0, 10).join(", ")}`;

    let responseText;
    try {
        console.log(`Attempting to use primary model: ${CONFIG.PRIMARY_MODEL}`);
        responseText = await generateWithRetry(CONFIG.PRIMARY_MODEL, prompt);
    } catch (e) {
        console.log("Primary model failed. Switching to stable fallback...");
        responseText = await generateWithRetry(CONFIG.BACKUP_MODEL, prompt);
    }

    try {
        const quoteData = JSON.parse(responseText);
        quoteData.generatedDate = today;
        fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(quoteData));
        historyData.unshift(quoteData);
        fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData.slice(0, 30), null, 2));
        await postToDiscord(quoteData);
        console.log("Success!");
    } catch (err) {
        console.error("Final Processing Error:", err.message);
        process.exit(1);
    }
}

main();
