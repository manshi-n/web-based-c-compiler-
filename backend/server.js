require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const Groq = require("groq-sdk");

const app = express();

/* ---------- MIDDLEWARE ---------- */
app.use(cors());
app.use(express.json());

/* ---------- FRONTEND ---------- */
app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

/* ---------- GROQ ---------- */
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

/* ---------- TEMP DIR ---------- */
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

/* ---------- CLEAN CODE ---------- */
function cleanCode(code) {
    return code ? code.replace(/```[a-z]*|```/g, "").trim() : "";
}

/* ---------- COMPLEXITY ---------- */
function estimateComplexity(code) {
    const nestedLoopPattern =
        /for[\s\S]*?{[\s\S]*?(for|while)|while[\s\S]*?{[\s\S]*?(for|while)/;

    const loops = (code.match(/\b(for|while)\b/g) || []).length;

    if (nestedLoopPattern.test(code)) return "O(n^2)";
    if (loops === 1) return "O(n)";
    if (loops === 0) return "O(1)";
    if (loops >= 3) return "O(n^k)";

    return "O(n)";
}

/* ---------- SAFETY ---------- */
function safetyScore(code) {
    let score = 100;

    if (/gets\s*\(/.test(code)) score -= 40;
    if (/strcpy\s*\(/.test(code)) score -= 25;
    if (/scanf\s*\(/.test(code)) score -= 10;
    if (/\*\s*\w+\s*;/.test(code)) score -= 15;
    if (/\/\s*0/.test(code)) score -= 20;

    return Math.max(score, 0) + "%";
}

/* ---------- AI (FIXED + SAFE) ---------- */
async function getAISuggestion(code, compileError, runtimeError) {

    const prompt = `
Fix and optimize this C code.

CODE:
${code}

ERROR:
${compileError || runtimeError || "None"}

STRICT FORMAT:

BEFORE:
<code>

AFTER:
<fixed working C code (ONLY ONE main function)>

EXPLANATION:
- bullet points
- include what was wrong
- what was fixed
- time complexity before vs after
- safety reasoning

COMPLEXITY_BEFORE:
O(...)

COMPLEXITY_AFTER:
O(...)

SAFETY_BEFORE:
X%

SAFETY_AFTER:
X%
`;

    try {
        const response = await Promise.race([
            groq.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: "You are a strict C code analyzer." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.2
            }),

            new Promise((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), 15000)
            )
        ]);

        return response?.choices?.[0]?.message?.content || null;

    } catch (err) {
        console.log("❌ GROQ ERROR:", err.message);

        // ALWAYS fallback (IMPORTANT for deployment)
        return `
BEFORE:
${code}

AFTER:
${code}

EXPLANATION:
- AI unavailable (fallback mode)

COMPLEXITY_BEFORE:
O(?)

COMPLEXITY_AFTER:
O(?)

SAFETY_BEFORE:
100%

SAFETY_AFTER:
100%
`;
    }
}

/* ---------- EXTRACT ---------- */
function extractBlock(text, label) {
    if (!text) return "-";

    const regex = new RegExp(label + ":[\\s\\S]*?(?=\\n[A-Z_]+:|$)", "i");
    const match = text.match(regex);

    if (!match) return "-";

    return match[0]
        .replace(new RegExp(label + ":", "i"), "")
        .replace(/```[a-z]*|```/g, "")
        .trim();
}

/* ---------- COMPILE ---------- */
app.post('/compile', (req, res) => {

    let { code, language } = req.body;

    code = cleanCode(code);

    const ext = language === 'cpp' ? 'cpp' : 'c';
    const id = Date.now() + Math.floor(Math.random() * 10000);

    const file = path.join(TEMP_DIR, `prog_${id}.${ext}`);

    const exe = process.platform === "win32"
        ? path.join(TEMP_DIR, `prog_${id}.exe`)
        : path.join(TEMP_DIR, `prog_${id}`);

    fs.writeFileSync(file, code);

    const cmd = language === 'cpp'
        ? `g++ -Wall -Wextra "${file}" -o "${exe}"`
        : `gcc -Wall -Wextra "${file}" -o "${exe}"`;

    exec(cmd, (compileErr, stdout, stderr) => {

        if (compileErr) {
            return res.json({
                output: "",
                compileError: stderr || compileErr.message,
                runtimeError: ""
            });
        }

        const child = spawn(exe, [], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let output = "";
        let error = "";
        let compileWarnings = stderr || "";

        child.stdin.write("test\n");
        child.stdin.end();

        child.stdout.on("data", d => output += d.toString());
        child.stderr.on("data", d => error += d.toString());

        const timeout = setTimeout(() => {
            child.kill();
            return res.json({
                output,
                compileError: compileWarnings,
                runtimeError: "Execution timeout"
            });
        }, 5000);

        child.on("close", (code, signal) => {

            clearTimeout(timeout);

            let runtimeMsg = "";

            if (signal === "SIGSEGV") runtimeMsg = "Segmentation Fault";
            else if (signal === "SIGFPE") runtimeMsg = "Division by zero";
            else if (code !== 0) runtimeMsg = `Runtime Error ${code}`;

            try {
                fs.existsSync(file) && fs.unlinkSync(file);
                fs.existsSync(exe) && fs.unlinkSync(exe);
            } catch {}

            res.json({
                output: output.trim(),
                compileError: compileWarnings,
                runtimeError: error || runtimeMsg
            });
        });
    });
});

/* ---------- ANALYZE (FIXED SAFETY) ---------- */
app.post('/analyze', async (req, res) => {

    let { code, compileError, runtimeError } = req.body;

    code = cleanCode(code);

    const beforeComplexity = estimateComplexity(code);
    const beforeSafety = safetyScore(code);

    const aiText = await getAISuggestion(code, compileError, runtimeError);

    if (!aiText) {
        return res.json({
            before: code,
            after: code,
            explanation: "AI unavailable",
            complexity: `Before: ${beforeComplexity}\nAfter: ${beforeComplexity}`,
            safety: `Before: ${beforeSafety}\nAfter: ${beforeSafety}`
        });
    }

    const afterCode = extractBlock(aiText, "AFTER");

    res.json({
        before: extractBlock(aiText, "BEFORE") || code,
        after: afterCode,
        explanation: extractBlock(aiText, "EXPLANATION"),
        complexity: `Before: ${beforeComplexity}
After: ${estimateComplexity(afterCode)}`,
        safety: `Before: ${beforeSafety}
After: ${safetyScore(afterCode)}`
    });
});

/* ---------- START ---------- */
const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Backend running on port ${PORT}`);
});