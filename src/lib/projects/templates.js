// Project templates: every file is real and works without any paid service.
const te = (s) => new TextEncoder().encode(s);
const page = (title, body, extraHead = "") => `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${title}</title>\n${extraHead}<link rel="stylesheet" href="style.css">\n</head>\n<body>\n${body}\n<script src="script.js"></script>\n</body>\n</html>\n`;
const css = "*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:#050714;color:#fff;display:grid;place-items:center;min-height:100vh}main{text-align:center;padding:24px}h1{color:#00d5ff}button{background:#702cff;color:#fff;border:0;border-radius:12px;padding:12px 20px;font-size:16px}\n";

export const TEMPLATES = {
	website: { label: "Website (HTML, CSS, JS)", files: (n) => ({
		"index.html": page(n, `<main><h1>${n}</h1><p>Edit me, then run Web Studio to preview.</p><button id="b">Click me</button><p id="out"></p></main>`),
		"style.css": css,
		"script.js": `document.getElementById("b").addEventListener("click", () => {\n  document.getElementById("out").textContent = "Clicked at " + new Date().toLocaleTimeString();\n  console.log("button clicked");\n});\n`,
		"README.md": `# ${n}\n\nStatic website. Open index.html with Web Studio / the preview server.\n`,
	}) },
	react: { label: "React (CDN, no build step)", files: (n) => ({
		"index.html": page(n, `<div id="root"></div>`, `<script crossorigin src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.development.js"></script>\n<script crossorigin src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.development.js"></script>\n`),
		"style.css": css,
		"script.js": `const { useState } = React;\nfunction App() {\n  const [n, setN] = useState(0);\n  return React.createElement("main", null,\n    React.createElement("h1", null, ${JSON.stringify(n)}),\n    React.createElement("button", { onClick: () => setN(n + 1) }, "Count: " + n));\n}\nReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));\n`,
		"README.md": `# ${n}\n\nReact via CDN (needs internet to load React). For a JSX/Vite build, use the Linux terminal: \`npm create vite@latest\`.\n`,
	}) },
	python: { label: "Python project", files: (n) => ({
		"main.py": `def greet(name: str) -> str:\n    return f"Hello, {name}!"\n\n\nif __name__ == "__main__":\n    print(greet("${n}"))\n`,
		"README.md": `# ${n}\n\nRun with \`python main.py\` in the Linux terminal (apk add python3).\n`,
		".gitignore": "__pycache__/\n*.pyc\n.venv/\n",
	}) },
	pwa: { label: "Android web app (PWA)", files: (n) => ({
		"index.html": page(n, `<main><h1>${n}</h1><p>Installable web app.</p></main>`, `<link rel="manifest" href="manifest.json">\n<meta name="theme-color" content="#050714">\n`).replace("</body>", `<script>if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");</script>\n</body>`),
		"style.css": css,
		"script.js": `console.log("${n} started");\n`,
		"manifest.json": `${JSON.stringify({ name: n, short_name: n.slice(0, 12), start_url: "./index.html", display: "standalone", background_color: "#050714", theme_color: "#702cff", icons: [] }, null, 2)}\n`,
		"sw.js": `const CACHE = "app-v1";\nconst FILES = ["./", "index.html", "style.css", "script.js", "manifest.json"];\nself.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))));\nself.addEventListener("fetch", (e) => e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request))));\n`,
		"README.md": `# ${n}\n\nPWA starter. Add 192x192 and 512x512 PNG icons to manifest.json before installing. Serve over HTTPS or localhost.\n`,
	}) },
	sqlite: { label: "SQLite database project", files: (n) => ({
		"schema.sql": "CREATE TABLE IF NOT EXISTS items (\n  id INTEGER PRIMARY KEY,\n  title TEXT NOT NULL,\n  created_at TEXT DEFAULT CURRENT_TIMESTAMP\n);\nINSERT INTO items (title) VALUES ('first item');\n",
		"README.md": `# ${n}\n\nOpen Database Studio, paste schema.sql into the SQL editor and run it.\n`,
	}) },
	api: { label: "API server (Node.js + Express)", files: (n) => ({
		"package.json": `${JSON.stringify({ name: n.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "api", version: "1.0.0", main: "server.js", scripts: { start: "node server.js" }, dependencies: { express: "^4.19.2" } }, null, 2)}\n`,
		"server.js": `const express = require("express");\nconst app = express();\napp.use(express.json());\napp.get("/health", (_req, res) => res.json({ ok: true }));\napp.listen(3000, () => console.log("listening on http://127.0.0.1:3000"));\n`,
		"README.md": `# ${n}\n\nIn the Linux terminal: apk add nodejs npm && npm install && npm start. Test it in API Studio at http://127.0.0.1:3000/health\n`,
		".gitignore": "node_modules/\n",
	}) },
};
export const templateFiles = (id, name) => { const t = TEMPLATES[id]; if (!t) throw new Error(`Unknown template ${id}`); return Object.fromEntries(Object.entries(t.files(name)).map(([p, c]) => [p, te(c)])); };
