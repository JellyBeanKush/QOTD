import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_quote.txt',
    HISTORY_FILE: 'quote_history.json',
    PRIMARY_MODEL: "gemini-2.5-flash", 
    BACKUP_MODEL: "gemini-1.5-flash-latest"
};

// This creates the exact format: "February 23, 2026"
const options = { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' };
const todayFormatted = new Date().toLocaleDateString('en-US', options); 

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
        embeds: [{
            // Header is strictly one line: "Quote of the Day - February 23, 2026"
            title: `Quote of the Day - ${todayFormatted}`,
            description: `**"${quoteData.quote}"**\n\n— *${quoteData.author}*\n\n[Learn more about the author](${quoteData.sourceUrl})`,
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
            if (i < retries - 1) await new Promise(r => setTimeout(r, 5000));
            else throw error;
        }
    }
    throw new Error("Retries exhausted.");
}

async function main() {
    let historyData = [];
    
    // 1. Load History & Repair if needed
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try { 
            const content = fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8');
            const parsed = JSON.parse(content);
            historyData = Array.isArray(parsed) ? parsed.filter(item => typeof item === 'object' && item !== null) : [];
        } catch (e) { 
            historyData = [];
        }
    }

    // 2. Already Posted Check
    if (historyData.length > 0 && historyData[0].generatedDate === todayFormatted) {
        console.log("Already posted today.");
        return;
    }

    const usedAuthors = historyData.slice(0, 50).map(h => h.author);

    // 3. Generate Quote (Gemini 2.5 Flash)
    const prompt = `Provide a famous, inspiring quote. JSON ONLY: {
      "quote": "text", 
      "author": "Full Name", 
      "sourceUrl": "Wikipedia URL"
    }. DO NOT use these authors: ${usedAuthors.join(", ")}`;
    
    let responseText;
    try {
        responseText = await generateWithRetry(CONFIG.PRIMARY_MODEL, prompt);
    } catch (e) {
        responseText = await generateWithRetry(CONFIG.BACKUP_MODEL, prompt);
    }

    try {
        const quoteData = JSON.parse(responseText);
        quoteData.generatedDate = todayFormatted;
        
        // 4. Update current_quote.txt (For Mix It Up)
        fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(quoteData, null, 2));
        
        // 5. Update History
        historyData.unshift(quoteData);
        fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData.slice(0, 100), null, 2));
        
        await postToDiscord(quoteData);
        console.log(`Success: Posted ${quoteData.author}`);
    } catch (err) {
        console.error("Critical JSON Error:", err.message);
        process.exit(1);
    }
}

main();
