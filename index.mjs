import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: "https://discord.com/api/webhooks/1474465221006590063/IvnggafEtAywFbwIkdvRYEFWKge7FMwKzLmFHcqVYgJLf-aUfZkidEd9voSSfVwcatCB",
    SAVE_FILE: 'current_quote.txt',
    HISTORY_FILE: 'quote_history.json'
};

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Los_Angeles' });

async function postToDiscord(quoteData) {
    // We use the imagePrompt to tell Discord/Users what the vibe of the quote is
    const discordPayload = {
        username: "Quote of the Day",
        embeds: [{
            title: `💬 DAILY INSPIRATION: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' })}`,
            description: `## **"${quoteData.quote}"**\n\n— ***${quoteData.author}***\n\n**The Meaning**\n${quoteData.context}\n\n🔗 [Learn more about this quote](${quoteData.sourceUrl})`,
            color: 0xf1c40f,
            footer: { text: `Visual Vibe: ${quoteData.imagePrompt}` }
        }]
    };

    await fetch(CONFIG.DISCORD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(discordPayload)
    });
}

async function main() {
    if (fs.existsSync(CONFIG.SAVE_FILE)) {
        try {
            const saved = JSON.parse(fs.readFileSync(CONFIG.SAVE_FILE, 'utf8'));
            if ((saved.generatedDate || saved.date) === today) {
                console.log(`♻️ Quote for ${today} found. Updating Discord...`);
                await postToDiscord(saved);
                return;
            }
        } catch (e) { console.log("Initializing format..."); }
    }

    let historyData = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try {
            historyData = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8'));
        } catch (e) { console.log("History initialized."); }
    }
    const usedAuthors = historyData.map(h => h.author.toLowerCase());

    console.log(`🚀 Generating high-quality attributed quote for ${today}...`);
    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    const PROMPT = `Provide a powerful quote with strict attribution.
    JSON ONLY: {
      "quote": "The quote text",
      "author": "Full Name of Author",
      "sourceUrl": "A real URL to a biography or the source of the quote (Goodreads, Wikipedia, etc)",
      "context": "Why this matters today.",
      "imagePrompt": "A 1-sentence description of a motivational AI-generated image that matches this quote's theme."
    }`;
    
    const result = await model.generateContent(PROMPT + ` DO NOT use these authors: ${usedAuthors.join(", ")}`);
    const quoteData = JSON.parse(result.response.text().replace(/```json|```/g, "").trim());

    if (quoteData) {
        quoteData.generatedDate = today;
        fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(quoteData));
        historyData.unshift(quoteData); 
        fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData, null, 2));
        await postToDiscord(quoteData);
        console.log(`✅ Quote by ${quoteData.author} posted with source link!`);
    }
}
main();
