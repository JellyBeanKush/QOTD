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

async function postToDiscord(quoteData) {
    // 1. THE LINK SCRUBBER: This stops the empty boxes you're seeing.
    // If it's a Wikipedia page link or missing an image extension, use a reliable fallback.
    let finalImageUrl = quoteData.imageUrl;
    const isBadLink = !finalImageUrl || finalImageUrl.includes("/wiki/File:") || !finalImageUrl.match(/\.(jpg|jpeg|png|webp)$/i);
    
    if (isBadLink) {
        console.log("AI provided a webpage link instead of a raw image. Using fallback.");
        finalImageUrl = "https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&q=80&w=1000";
    }

    const discordPayload = {
        embeds: [{
            title: `Quote of the Day - ${displayDate}`,
            description: `"${quoteData.quote}"\n\n— *${quoteData.author}*\n\n[Learn more about the author](${quoteData.sourceUrl})`,
            color: 0xf1c40f, 
            thumbnail: { 
                url: finalImageUrl // This keeps the MLK top-right look
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
                setTimeout(() => reject(new Error('Gemini timed out')), 25000)
            );

            const result = await Promise.race([
                model.generateContent(prompt),
                timeoutPromise
            ]);

            return result.response.text().replace(/```json|```/g, "").trim();
        } catch (error) {
            console.log(`Error on attempt ${i + 1}: ${error.message}`);
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

    const prompt = `Provide an inspiring Quote of the Day.
    JSON ONLY: {
      "quote": "The quote text",
      "author": "Author Name",
      "sourceUrl": "Wikipedia URL",
      "imageUrl": "DIRECT RAW IMAGE LINK"
    }.
    CRITICAL: imageUrl MUST be a direct raw file (ending in .jpg or .png).
    NEVER use a link containing "/wiki/File:". 
    Look specifically for 'upload.wikimedia.org' links.
    If no direct raw file is available, use a high-quality landscape photo link from Unsplash.
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

            // Save history
            fs.writeFileSync(CONFIG.SAVE_FILE, `"${quoteData.quote}" — ${quoteData.author}`);
            historyData.unshift(quoteData);
            fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData, null, 2));

            // Post to Discord
            await postToDiscord(quoteData);
            console.log("QOTD Post complete.");
        }
    } catch (err) {
        console.error("Critical Failure:", err.message);
        process.exit(1);
    }
}

main();
