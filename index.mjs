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
    // This ensures we use the "thumbnail" field for the MLK look (top-right image)
    const discordPayload = {
        embeds: [{
            title: `Quote of the Day - ${displayDate}`,
            description: `"${quoteData.quote}"\n\n— *${quoteData.author}*\n\n[Learn more about the author](${quoteData.sourceUrl})`,
            color: 0xf1c40f, 
            thumbnail: { 
                url: quoteData.imageUrl 
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
                setTimeout(() => reject(new Error('Gemini API timed out')), 30000)
            );

            const result = await Promise.race([
                model.generateContent(prompt),
                timeoutPromise
            ]);

            return result.response.text().replace(/```json|```/g, "").trim();
        } catch (error) {
            console.log(`Attempt ${i + 1} failed: ${error.message}`);
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

    const prompt = `Provide an inspiring Quote of the Day from a famous historical figure.
    JSON ONLY: {
      "quote": "The quote text",
      "author": "Author Name",
      "sourceUrl": "Wikipedia URL",
      "imageUrl": "DIRECT RAW IMAGE LINK"
    }.
    CRITICAL IMAGE RULES:
    1. The imageUrl MUST be a direct link to a raw file ending in .jpg or .png.
    2. NEVER use a link containing "/wiki/File:" - these are web pages and do not work.
    3. Use direct 'upload.wikimedia.org' links.
    4. If no direct raw file is found, use a high-quality portrait from Unsplash: https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=1000&auto=format&fit=crop
    DO NOT use these authors: ${usedAuthors.join(", ")}`;

    try {
        console.log("Connecting to Gemini...");
        let responseText = await generateWithRetry(CONFIG.PRIMARY_MODEL, prompt);
        
        if (!responseText) {
            console.log("Primary model failed, trying backup...");
            responseText = await generateWithRetry(CONFIG.BACKUP_MODEL, prompt);
        }

        if (responseText) {
            const quoteData = JSON.parse(responseText);

            // Clean up the URL just in case Gemini ignored the instructions
            if (quoteData.imageUrl.includes("/wiki/File:")) {
                console.log("AI provided a webpage link. Overriding with a portrait fallback.");
                quoteData.imageUrl = "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=1000&auto=format&fit=crop";
            }

            if (historyData.length > 0 && historyData[0].quote === quoteData.quote) {
                console.log("Duplicate detected. Skipping.");
                return;
            }

            fs.writeFileSync(CONFIG.SAVE_FILE, `"${quoteData.quote}" — ${quoteData.author}`);
            historyData.unshift(quoteData);
            fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData, null, 2));

            await postToDiscord(quoteData);
            console.log("Success! Posted to Discord.");
        }
    } catch (err) {
        console.error("Critical Error:", err.message);
        process.exit(1);
    }
}

main();
