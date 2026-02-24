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
    // Check if the URL is a direct image. If not, we use a high-res placeholder so it never looks empty.
    const validImage = (quoteData.imageUrl && quoteData.imageUrl.match(/\.(jpg|jpeg|png|webp|gif)$/i)) 
        ? quoteData.imageUrl 
        : "https://images.unsplash.com/photo-1455390582262-044cdead277a?q=80&w=1000&auto=format&fit=crop";

    const discordPayload = {
        embeds: [{
            title: `Quote of the Day - ${displayDate}`,
            description: `"${quoteData.quote}"\n\n— *${quoteData.author}*\n\n[Learn more about the author](${quoteData.sourceUrl})`,
            color: 0xf1c40f, 
            thumbnail: { 
                url: validImage // This puts it in the top-right like MLK
            }
        }]
    };

    console.log(`Sending Image URL to Discord: ${validImage}`);

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
            const content = fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8');
            historyData = JSON.parse(content);
        } catch (e) { historyData = []; }
    }

    const usedAuthors = historyData.slice(0, 50).map(h => h.author);

    const prompt = `Provide an inspiring Quote of the Day from a historical figure.
    JSON ONLY: {
      "quote": "The quote text",
      "author": "Author Name",
      "sourceUrl": "Wikipedia URL",
      "imageUrl": "DIRECT .jpg link"
    }.
    CRITICAL INSTRUCTION FOR IMAGE: 
    You MUST provide a DIRECT link to a .jpg or .png file from Wikimedia Commons (usually starts with upload.wikimedia.org).
    If a direct photo of the author is not available, provide a high-quality aesthetic landscape photo URL from Unsplash.
    NEVER provide a link to a .html page or a Wikipedia 'File:' page.
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

            if (historyData.length > 0 && historyData[0].quote === quoteData.quote) {
                console.log("Duplicate detected. Skipping.");
                return;
            }

            fs.writeFileSync(CONFIG.SAVE_FILE, `"${quoteData.quote}" — ${quoteData.author}`);
            historyData.unshift(quoteData);
            fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData, null, 2));

            await postToDiscord(quoteData);
            console.log("QOTD Posted successfully.");
        }
    } catch (err) {
        console.error("Critical Error:", err.message);
        process.exit(1);
    }
}

main();
