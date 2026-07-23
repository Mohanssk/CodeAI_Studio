import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Setup paths for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;
const isVercel = Boolean(process.env.VERCEL);
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const requestBuckets = new Map();

// Middleware
app.use(cors());
app.use(express.json());
app.set('trust proxy', true);
app.use((req, res, next) => {
    if (req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html'))) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});
// Serve the frontend files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// 1. Initialize the client
const ai = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;

app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'code_file_generator',
        environment: isVercel ? 'vercel' : 'local',
    });
});

function getClientKey(req) {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
        return forwardedFor.split(',')[0].trim();
    }

    return req.ip || req.socket?.remoteAddress || 'unknown';
}

function isRateLimited(req) {
    const clientKey = getClientKey(req);
    const now = Date.now();
    const bucket = requestBuckets.get(clientKey);

    if (!bucket || bucket.resetAt <= now) {
        requestBuckets.set(clientKey, {
            count: 1,
            resetAt: now + RATE_LIMIT_WINDOW_MS,
        });
        return null;
    }

    bucket.count += 1;
    requestBuckets.set(clientKey, bucket);

    if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
        return Math.ceil((bucket.resetAt - now) / 1000);
    }

    return null;
}

// 2. Create the API Endpoint
app.post('/api/generate', async (req, res) => {
    const { customFilenameBase, userRequest } = req.body;

    if (!customFilenameBase || !userRequest) {
        return res.status(400).json({ error: "Missing filename or prompt." });
    }

    if (!ai) {
        return res.status(500).json({
            error: 'GEMINI_API_KEY is not configured. Set it in your Vercel project environment variables.',
        });
    }

    const retryAfterSeconds = isRateLimited(req);
    if (retryAfterSeconds) {
        res.setHeader('Retry-After', String(retryAfterSeconds));
        return res.status(429).json({
            error: 'Too many generate requests. Please wait before trying again.',
            retryAfterSeconds,
        });
    }

    try {
        console.log(`\nReceived request to generate: ${customFilenameBase}`);
        
        // 3. Define a strict JSON prompt
        const prompt = `${userRequest}\n\n` +
            "CRITICAL INSTRUCTIONS:\n" +
            "1. Analyze the request and determine the most appropriate programming language and file extension.\n" +
            "2. Output ONLY a raw JSON object. Do not include markdown code blocks (like ```json), greetings, or explanations.\n" +
            "3. The JSON object must contain exactly two keys: 'extension' and 'code'.\n" +
            "4. The 'extension' value must include the leading dot (e.g., '.py', '.js', '.cpp', '.jsx').\n" +
            "5. The 'code' value must contain the raw, executable code.\n" +
            "Example Output:\n" +
            '{"extension": ".js", "code": "console.log(\'Hello\');"}';

        // 4. Get the response from Gemini
        const response = await ai.models.generateContent({
            model: "gemini-3.6-flash", 
            contents: prompt,
        });

        // 5. Clean up the response to ensure it's pure JSON
        let cleanText = response.text.trim();
        if (cleanText.startsWith("```")) {
            const lines = cleanText.split("\n");
            cleanText = lines.slice(1, -1).join("\n").trim();
        }

        // 6. Parse the JSON and extract the data
        const data = JSON.parse(cleanText);
        const extension = data.extension || ".txt";
        const codeContent = data.code || "";
        const finalFilename = customFilenameBase + extension;
        console.log(`Success! Generated ${finalFilename}`);

        // Send success back to the frontend
        res.json({
            success: true,
            message: `Code generated for ${finalFilename}`,
            extension: extension,
            code: codeContent,
            filename: finalFilename // Passing this back so the frontend knows what to request
        });

    } catch (error) {
        console.error("Server Error:", error.message);
        res.status(500).json({ error: error.message || "Failed to generate code." });
    } finally {
        const clientKey = getClientKey(req);
        const bucket = requestBuckets.get(clientKey);

        if (bucket && bucket.resetAt <= Date.now()) {
          requestBuckets.delete(clientKey);
        }
    }
});

export default app;

// Start the server only for local development.
if (!isVercel) {
    app.listen(port, () => {
        console.log(`Backend running! API is at http://localhost:${port}/api/generate`);
        console.log(`Health check available at http://localhost:${port}/api/health`);
        console.log(`Frontend is available at http://localhost:${port}`);
    });
}