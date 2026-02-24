import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_qotd.txt',
    HISTORY_FILE: 'qotd_history.json',
    PRIMARY_MODEL: "gemini-2.5-flash", 
    BACKUP_MODEL: "gemini-1.5-flash"
};

const options = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' };
const displayDate = new Date().toLocaleDateString('en-US', options);

// This function fixes the "Wikipedia File Page" issue you saw in your screenshot
function getRawImageUrl(url) {
    if (!url) return "https://images.unsplash.com/photo-1455390582262-044cdead277a?q=80&w=1000";
    
    // If the AI gives a Wikipedia "File:" page, we try to point it to a high-res fallback 
    // because Discord cannot render HTML pages as images.
    if (url.includes("wikipedia.org/wiki/File:") || !url.match(/\.(jpg|jpeg|png|webp)$/i)) {
        console.log("AI provided a webpage link. Using a high-quality placeholder to keep the MLK look.");
        return "https://images.unsplash.com/photo-1455390582262-044cdead277a?q=80&w=1000";
    }
    return url;
}

async function postToDiscord(quoteData) {
    const finalImage = getRawImageUrl(quoteData.imageUrl);

    const discordPayload = {
        embeds: [{
            title: `Quote of the Day - ${displayDate}`,
            description: `"${quoteData.quote}"\n\n— *${quoteData.author}*\n\n[Learn more about the author](${quoteData.sourceUrl})`,
            color: 0xf1c40f, 
            thumbnail: { 
                url: finalImage // This puts it in the top-right corner like the MLK post
            }
        }]
    };

    await fetch(CONFIG.DISCORD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(discordPayload)
    });
}

async function generateWithRetry(modelName, prompt) {
    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
    const model = genAI.getGenerativeModel({ model: modelName });

    for (let i = 0; i < 3; i++) {
        try {
            console.log(`Attempt ${i + 1} with ${modelName}...`);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Gemini timed out')), 30000)
            );

            const result = await Promise.race([
                model.generateContent(prompt),
                timeoutPromise
            ]);

            return result.response.text().replace(/```json|```/g, "").trim();
        } catch (error) {
            console.log(`Error: ${error.message}`);
            if (i < 2) await new Promise(r => setTimeout(r, 5000));
        }
    }
    return null;
}

async function main() {
    let historyData = [];

    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try {
            historyData = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8'));
        } catch (e) { historyData = []; }
    }

    const usedAuthors = historyData.slice(0, 50).map(h => h.author);

    const prompt = `Provide an inspiring Quote of the Day from a historical figure.
    JSON ONLY: {
      "quote": "The quote text",
      "author": "Author Name",
      "sourceUrl": "Wikipedia URL",
      "imageUrl": "DIRECT RAW IMAGE LINK"
    }.
    CRITICAL IMAGE RULES:
    1. The imageUrl MUST be a direct link to a raw file (ending in .jpg or .png).
    2. NEVER provide a link to a Wikipedia 'File:' page or any .html page.
    3. Look for links starting with 'https://upload.wikimedia.org/'.
    4. If no raw .jpg link exists, use this fallback: https://images.unsplash.com/photo-1455390582262-044cdead277a?q=80&w=1000
    DO NOT use these authors: ${usedAuthors.join(", ")}`;

    try {
        console.log("Connecting to Gemini...");
        let responseText = await generateWithRetry(CONFIG.PRIMARY_MODEL, prompt);
        
        if (!responseText) {
            console.log("Trying backup model...");
            responseText = await generateWithRetry(CONFIG.BACKUP_MODEL, prompt);
        }

        if (responseText) {
            const quoteData = JSON.parse(responseText);

            if (historyData.length > 0 && historyData[0].quote === quoteData.quote) {
                console.log("Duplicate quote.");
                return;
            }

            fs.writeFileSync(CONFIG.SAVE_FILE, `"${quoteData.quote}" — ${quoteData.author}`);
            historyData.unshift(quoteData);
            fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData, null, 2));

            await postToDiscord(quoteData);
            console.log("Successfully posted to Discord with image logic fixed.");
        }
    } catch (err) {
        console.error("Critical Error:", err.message);
        process.exit(1);
    }
}

main();
