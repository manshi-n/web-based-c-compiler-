// MONACO EDITOR
let editor;
require(["vs/editor/editor.main"], function () {
    editor = monaco.editor.create(document.getElementById("editor"), {
        value: `#include <stdio.h>\nint main() {\n    printf("Hello World\\n");\n    return 0;\n}`,
        language: "c",
        theme: "vs-dark",
        automaticLayout: true
    });
});

// BEGINNER FUNCTION CHECKER
const unsafeFunctions = [
    { name: "gets", safe: "fgets", explanation: "Use fgets(buffer, size, stdin) to avoid buffer overflow." },
    { name: "strcpy", safe: "strncpy", explanation: "Use strncpy to prevent buffer overflow." },
    { name: "strcat", safe: "strncat", explanation: "Use strncat for safe string concatenation." },
    { name: "scanf", safe: "fgets or scanf with length", explanation: "Use length specifiers to avoid overflow." },
    { name: "sprintf", safe: "snprintf", explanation: "Use snprintf for safe formatting." }
];

function checkUnsafeFunctions(code) {
    let results = [];
    unsafeFunctions.forEach(f => {
        const regex = new RegExp(`\\b${f.name}\\s*\\(`, "g");
        if (regex.test(code)) {
            results.push(`⚠️ Unsafe function "${f.name}" detected. Safe alternative: "${f.safe}". ${f.explanation}`);
        }
    });
    return results;
}

// RUN BUTTON
document.getElementById("run-btn").addEventListener("click", async () => {
    const code = editor.getValue();
    const language = document.getElementById("lang-select").value;
    const mode = document.getElementById("mode-select").value;

    // Clear previous outputs
    document.getElementById("output").textContent = "Running...";
    document.getElementById("errors").textContent = "";
    document.getElementById("analysis").textContent = "";
    document.getElementById("complexity").textContent = "-";
    document.getElementById("suggestions").textContent = "";

    try {
        let res = await fetch("http://localhost:5000/compile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, language, mode })
        });
        let data = await res.json();

        document.getElementById("output").textContent = data.output || "No output.";
        document.getElementById("errors").textContent = data.errors || "No errors.";

        if(mode === "beginner") {
            const unsafeTips = checkUnsafeFunctions(code);
            document.getElementById("analysis").textContent = (data.analysis || "") + "\n" + unsafeTips.join("\n");
            document.getElementById("complexity").textContent = data.complexity || "O(n)";
            document.getElementById("suggestions").textContent = (data.suggestions || "Use descriptive variable names, modularize code.");
        } else {
            document.getElementById("analysis").textContent = data.analysis || "";
            document.getElementById("complexity").textContent = data.complexity || "-";
            document.getElementById("suggestions").textContent = "";
        }

    } catch (err) {
        document.getElementById("errors").textContent = "⚠️ Server error: " + err;
    }
});