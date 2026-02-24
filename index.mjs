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
    // This creates a direct, guaranteed image link based on the author's name
    const authorSearch = encodeURIComponent(quoteData.author);
    const guaranteedImage = `https://source.unsplash.com/featured/?${authorSearch},portrait`;

    const discordPayload = {
        embeds: [{
            title: `Quote of the Day - ${displayDate}`,
            description: `"${quoteData.quote}"\n\n— *${quoteData.author}*\n\n[Learn more about the author](${quoteData.sourceUrl})`,
            color: 0xf1c40f, 
            thumbnail: { 
                url: guaranteedImage // Force the MLK top-right thumbnail style
            }
        }]
    };

    console.log(`Sending guaranteed image for: ${quoteData.author}`);

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
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Gemini timed out')), 25000)
            );
            const result = await Promise.race([model.generateContent(prompt), timeoutPromise]);
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
        try { historyData = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8')); } catch (e) {}
    }

    const usedAuthors = historyData.slice(0, 50).map(h => h.author);

    const prompt = `Provide an inspiring Quote of the Day from a historical figure.
    JSON ONLY: {
      "quote": "The quote text",
      "author": "Author Name",
      "sourceUrl": "Wikipedia URL"
    }
    DO NOT use these authors: ${usedAuthors.join(", ")}`;

    try {
        let responseText = await generateWithRetry(CONFIG.PRIMARY_MODEL, prompt);
        if (!responseText) responseText = await generateWithRetry(CONFIG.BACKUP_MODEL, prompt);

        if (responseText) {
            const quoteData = JSON.parse(responseText);
            
            fs.writeFileSync(CONFIG.SAVE_FILE, `"${quoteData.quote}" — ${quoteData.author}`);
            historyData.unshift(quoteData);
            fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData, null, 2));

            await postToDiscord(quoteData);
            console.log("Success! Posted with guaranteed image.");
        }
    } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
    }
}

main();
