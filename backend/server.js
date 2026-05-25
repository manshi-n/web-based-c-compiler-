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

/* ---------- TEMP DIRECTORY ---------- */

const TEMP_DIR = path.join(__dirname, 'temp');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

/* ---------- CLEAN CODE ---------- */

function cleanCode(code) {

    return code
        ? code.replace(/```[a-z]*|```/g, "").trim()
        : "";
}

/* ---------- FALLBACK COMPLEXITY ---------- */

function estimateComplexity(code) {

    const loops =
        (code.match(/\b(for|while)\b/g) || []).length;

    if (loops === 0) return "O(1)";
    if (loops === 1) return "O(n)";
    if (loops === 2) return "O(n^2)";
    if (loops === 3) return "O(n^3)";

    return "O(n^k)";
}

/* ---------- FALLBACK SAFETY ---------- */

function safetyScore(code) {

    let score = 100;

    if (/gets\s*\(/.test(code)) score -= 40;

    if (/strcpy\s*\(/.test(code)) score -= 25;

    if (/scanf\s*\(/.test(code)) score -= 10;

    if (/\*\s*\w+\s*;/.test(code)) score -= 15;

    if (/\/\s*0/.test(code)) score -= 20;

    return Math.max(score, 0) + "%";
}

/* ---------- AI ---------- */

async function getAISuggestion(code, compileError, runtimeError) {

    try {

        const response =
            await groq.chat.completions.create({

                model: "llama-3.3-70b-versatile",

                messages: [

                    {
                        role: "system",
                        content:
                            "You are an expert C debugger and code analyzer."
                    },

                    {
                        role: "user",
                        content: `

Analyze and fix this C code.

CODE:
${code}

ERROR:
${compileError || runtimeError || "None"}

RULES:
1. Fix ALL bugs
2. Maintain correct logic
3. Calculate REAL time complexity
4. Calculate SAFETY score using:
   gets() → -40
   strcpy() → -25
   scanf() → -10
   uninitialized pointer → -15
   division by zero → -20

Return EXACT format:

BEFORE:
${code}

AFTER:
<fixed code>

EXPLANATION:
<short explanation>

COMPLEXITY_BEFORE:
O(...)

COMPLEXITY_AFTER:
O(...)

SAFETY_BEFORE:
X%

SAFETY_AFTER:
X%
`
                    }
                ],

                temperature: 0.2
            });

        return response.choices[0].message.content;

    } catch (err) {

        console.log("❌ GROQ ERROR:", err.message);

        return null;
    }
}

/* ---------- EXTRACT ---------- */

function extractBlock(text, label) {

    if (!text) return "-";

    const regex =
        new RegExp(
            label + ":[\\s\\S]*?(?=\\n[A-Z_]+:|$)",
            "i"
        );

    const match = text.match(regex);

    if (!match) return "-";

    return match[0]
        .replace(new RegExp(label + ":", "i"), "")
        .replace(/```[a-z]*|```/g, "")
        .trim();
}

/* ---------- VALIDATE ---------- */

function isValidAI(text) {

    return text &&
        text.includes("AFTER:") &&
        text.includes("EXPLANATION:") &&
        text.includes("COMPLEXITY_BEFORE:") &&
        text.includes("COMPLEXITY_AFTER:") &&
        text.includes("SAFETY_BEFORE:") &&
        text.includes("SAFETY_AFTER:");
}

/* ---------- COMPILE ---------- */

app.post('/compile', (req, res) => {

    let { code, language } = req.body;

    code = cleanCode(code);

    const ext =
        language === 'cpp' ? 'cpp' : 'c';

    const id = Date.now();

    const file =
        path.join(TEMP_DIR, `prog_${id}.${ext}`);

    const exe =
        path.join(TEMP_DIR, `prog_${id}.exe`);

    fs.writeFileSync(file, code);

    const cmd =
        language === 'cpp'
            ? `g++ -Wall -Wextra "${file}" -o "${exe}"`
            : `gcc -Wall -Wextra "${file}" -o "${exe}"`;

    exec(cmd, (compileErr, stdout, stderr) => {

        if (compileErr) {

            fs.existsSync(file) &&
                fs.unlinkSync(file);

            return res.json({
                output: "",
                compileError:
                    stderr || compileErr.message,
                runtimeError: ""
            });
        }

        if (stderr) {

            return res.json({
                output: "",
                compileError: stderr,
                runtimeError: ""
            });
        }

        const child =
            spawn(exe, [], { stdio: 'pipe' });

        let output = "";

        let error = "";

        child.stdin.write("test\n");

        child.stdin.end();

        child.stdout.on("data", (data) => {
            output += data.toString();
        });

        child.stderr.on("data", (data) => {
            error += data.toString();
        });

        child.on("close", (code, signal) => {

            let runtimeMsg = "";

            if (signal === "SIGSEGV") {

                runtimeMsg =
                    "Segmentation Fault (Invalid memory access)";
            }

            else if (signal === "SIGFPE") {

                runtimeMsg =
                    "Division by zero error";
            }

            else if (code !== 0) {

                runtimeMsg =
                    `Runtime Error (exit code ${code})`;
            }

            try {

                fs.existsSync(file) &&
                    fs.unlinkSync(file);

                fs.existsSync(exe) &&
                    fs.unlinkSync(exe);

            } catch {}

            res.json({

                output:
                    output.trim() || "",

                compileError: "",

                runtimeError:
                    error || runtimeMsg
            });
        });
    });
});

/* ---------- ANALYZE ---------- */

app.post('/analyze', async (req, res) => {

    let {
        code,
        compileError,
        runtimeError
    } = req.body;

    code = cleanCode(code);

    const beforeComplexity =
        estimateComplexity(code);

    const beforeSafety =
        safetyScore(code);

    const aiText =
        await getAISuggestion(
            code,
            compileError,
            runtimeError
        );

    if (!isValidAI(aiText)) {

        return res.json({

            before: code,

            after: code,

            explanation: "⚠️ AI failed",

            complexity:
`Before: ${beforeComplexity}
After: ${beforeComplexity}`,

            safety:
`Before: ${beforeSafety}
After: ${beforeSafety}`
        });
    }

    const afterCode =
        extractBlock(aiText, "AFTER");

    const beforeC =
        extractBlock(aiText, "COMPLEXITY_BEFORE");

    const afterC =
        extractBlock(aiText, "COMPLEXITY_AFTER");

    const beforeS =
        extractBlock(aiText, "SAFETY_BEFORE");

    const afterS =
        extractBlock(aiText, "SAFETY_AFTER");

    res.json({

        before:
            extractBlock(aiText, "BEFORE") || code,

        after: afterCode,

        explanation:
            extractBlock(aiText, "EXPLANATION"),

        complexity:
`Before: ${beforeC || beforeComplexity}
After: ${afterC || estimateComplexity(afterCode)}`,

        safety:
`Before: ${beforeS || beforeSafety}
After: ${afterS || safetyScore(afterCode)}`
    });
});

/* ---------- START ---------- */

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {

    console.log(`🚀 Backend running on port ${PORT}`);
});