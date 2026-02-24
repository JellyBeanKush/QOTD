import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_qotd.txt',
    HISTORY_FILE: 'qotd_history.json',
    PRIMARY_MODEL: "gemini-2.0-flash", 
    BACKUP_MODEL: "gemini-1.5-flash"
};

const options = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' };
const displayDate = new Date().toLocaleDateString('en-US', options);

async function postToDiscord(quoteData) {
    const discordPayload = {
        embeds: [{
            title: `Quote of the Day — ${displayDate}`,
            description: `## "${quoteData.quote}"\n\n— **${quoteData.author}**\n\n[Learn more about the author](${quoteData.sourceUrl})`,
            color: 0xf1c40f, 
            image: { 
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
            
            // 30-second timeout to prevent the Action from hanging silently
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

    // 1. Load History 
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try {
            const content = fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8');
            historyData = JSON.parse(content);
        } catch (e) { historyData = []; }
    }

    const usedAuthors = historyData.slice(0, 50).map(h => h.author);

    const prompt = `Provide an inspiring Quote of the Day. 
    JSON ONLY: {
      "quote": "The quote text",
      "author": "Author Name",
      "sourceUrl": "Wikipedia link for the author",
      "imageUrl": "DIRECT .jpg or .png link of the author"
    }.
    CRITICAL: imageUrl MUST be a direct link to a file ending in .jpg or .png. 
    If a photo of the author is unavailable, use a high-quality landscape photo.
    DO NOT use these authors: ${usedAuthors.join(", ")}`;

    try {
        console.log("Connecting to Gemini...");
        let responseText = await generateWithRetry(CONFIG.PRIMARY_MODEL, prompt);
        
        if (!responseText) {
            console.log("Primary model failed, trying backup...");
            responseText = await generateWithRetry(CONFIG.BACKUP_MODEL, prompt);
        }

        if (responseText) {
            console.log("Received data from Gemini. Parsing...");
            const quoteData = JSON.parse(responseText);

            // 2. Simple Anti-Spam (Checks if exact quote was last)
            if (historyData.length > 0 && historyData[0].quote === quoteData.quote) {
                console.log("Duplicate quote detected. Skipping post.");
                return;
            }

            // 3. Save for Mix It Up
            fs.writeFileSync(CONFIG.SAVE_FILE, `"${quoteData.quote}" — ${quoteData.author}`);

            // 4. Update History 
            historyData.unshift(quoteData);
            fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData, null, 2));

            // 5. Post to Discord
            console.log("Posting to Discord...");
            await postToDiscord(quoteData);
            console.log("Success! Check Discord.");
        } else {
            console.log("Failed to get a valid response from Gemini after all attempts.");
        }
    } catch (err) {
        console.error("Critical Error:", err.message);
        process.exit(1);
    }
}

main();
