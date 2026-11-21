// App Studio: real Android (Gradle) project generator, manifest/gradle validators and editors.
// On-device APK compilation is not supported; builds run in GitHub Actions on the user's own repo.

const JAVA_KEYWORDS = new Set("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null".split(" "));
export function validatePackageName(name) {
	const n = String(name || "").trim();
	const parts = n.split(".");
	if (parts.length < 2 || !parts.every((p) => /^[a-z][a-z0-9_]*$/.test(p) && !JAVA_KEYWORDS.has(p))) throw new Error("Package name must look like com.example.myapp (lowercase, at least two parts, no Java keywords)");
	return n;
}
export function validateAppName(name) {
	const n = String(name || "").trim();
	if (!n || n.length > 40 || /[<>&"'\\\n]/.test(n)) throw new Error("App name: 1-40 characters, without < > & \" ' or backslash");
	return n;
}
const xmlEsc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const GRADLE_VERSION = "8.9";
const AGP = "8.5.2";
const KOTLIN = "2.0.20";

export function generateAndroidProject({ appName, packageName, language = "kotlin", minSdk = 24, compileSdk = 35 }) {
	const app = validateAppName(appName); const pkg = validatePackageName(packageName);
	if (!["kotlin", "java"].includes(language)) throw new Error("Language must be kotlin or java");
	if (!(minSdk >= 21 && minSdk <= compileSdk && compileSdk <= 36)) throw new Error("Invalid SDK levels");
	const kt = language === "kotlin"; const dir = pkg.replace(/\./g, "/"); const ext = kt ? "kt" : "java";
	const files = {
		"settings.gradle.kts": `pluginManagement {\n    repositories {\n        google()\n        mavenCentral()\n        gradlePluginPortal()\n    }\n}\ndependencyResolutionManagement {\n    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)\n    repositories {\n        google()\n        mavenCentral()\n    }\n}\nrootProject.name = ${JSON.stringify(app)}\ninclude(":app")\n`,
		"build.gradle.kts": `plugins {\n    id("com.android.application") version "${AGP}" apply false\n${kt ? `    id("org.jetbrains.kotlin.android") version "${KOTLIN}" apply false\n` : ""}}\n`,
		"gradle.properties": "org.gradle.jvmargs=-Xmx2g -Dfile.encoding=UTF-8\nandroid.useAndroidX=true\nandroid.nonTransitiveRClass=true\n",
		"app/build.gradle.kts": `plugins {\n    id("com.android.application")\n${kt ? '    id("org.jetbrains.kotlin.android")\n' : ""}}\n\nandroid {\n    namespace = "${pkg}"\n    compileSdk = ${compileSdk}\n\n    defaultConfig {\n        applicationId = "${pkg}"\n        minSdk = ${minSdk}\n        targetSdk = ${compileSdk}\n        versionCode = 1\n        versionName = "1.0.0"\n    }\n\n    buildTypes {\n        release {\n            isMinifyEnabled = false\n        }\n    }\n    compileOptions {\n        sourceCompatibility = JavaVersion.VERSION_17\n        targetCompatibility = JavaVersion.VERSION_17\n    }\n${kt ? '    kotlinOptions {\n        jvmTarget = "17"\n    }\n' : ""}}\n\ndependencies {\n    implementation("androidx.core:core-ktx:1.13.1")\n    implementation("androidx.appcompat:appcompat:1.7.0")\n    implementation("com.google.android.material:material:1.12.0")\n}\n`,
		"app/src/main/AndroidManifest.xml": `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n\n    <application\n        android:allowBackup="true"\n        android:label="@string/app_name"\n        android:supportsRtl="true"\n        android:theme="@style/Theme.App">\n        <activity\n            android:name=".MainActivity"\n            android:exported="true">\n            <intent-filter>\n                <action android:name="android.intent.action.MAIN" />\n                <category android:name="android.intent.category.LAUNCHER" />\n            </intent-filter>\n        </activity>\n    </application>\n\n</manifest>\n`,
		"app/src/main/res/layout/activity_main.xml": `<?xml version="1.0" encoding="utf-8"?>\n<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"\n    android:layout_width="match_parent"\n    android:layout_height="match_parent"\n    android:gravity="center"\n    android:orientation="vertical">\n\n    <TextView\n        android:id="@+id/title"\n        android:layout_width="wrap_content"\n        android:layout_height="wrap_content"\n        android:text="@string/app_name"\n        android:textSize="24sp" />\n</LinearLayout>\n`,
		"app/src/main/res/values/strings.xml": `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="app_name">${xmlEsc(app)}</string>\n</resources>\n`,
		"app/src/main/res/values/themes.xml": `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <style name="Theme.App" parent="Theme.Material3.DayNight.NoActionBar" />\n</resources>\n`,
		[`app/src/main/java/${dir}/MainActivity.${ext}`]: kt
			? `package ${pkg}\n\nimport android.os.Bundle\nimport androidx.appcompat.app.AppCompatActivity\n\nclass MainActivity : AppCompatActivity() {\n    override fun onCreate(savedInstanceState: Bundle?) {\n        super.onCreate(savedInstanceState)\n        setContentView(R.layout.activity_main)\n    }\n}\n`
			: `package ${pkg};\n\nimport android.os.Bundle;\nimport androidx.appcompat.app.AppCompatActivity;\n\npublic class MainActivity extends AppCompatActivity {\n    @Override\n    protected void onCreate(Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n        setContentView(R.layout.activity_main);\n    }\n}\n`,
		".gitignore": "*.iml\n.gradle/\nbuild/\nlocal.properties\n.idea/\n*.apk\n*.jks\n*.keystore\n",
		".github/workflows/android-build.yml": `name: Android debug APK\non:\n  push:\n    branches: [main]\n  workflow_dispatch:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-java@v4\n        with:\n          distribution: temurin\n          java-version: 17\n      - uses: android-actions/setup-android@v3\n      - uses: gradle/actions/setup-gradle@v4\n        with:\n          gradle-version: "${GRADLE_VERSION}"\n      - run: gradle --no-daemon assembleDebug\n      - uses: actions/upload-artifact@v4\n        with:\n          name: app-debug\n          path: app/build/outputs/apk/debug/*.apk\n`,
		"README.md": `# ${app}\n\nAndroid app (${kt ? "Kotlin" : "Java"}), package \`${pkg}\`.\n\nBuild: push to GitHub - the workflow in .github/workflows builds a debug APK as an artifact. APKs cannot be compiled on the phone itself.\n`,
	};
	return Object.fromEntries(Object.entries(files).map(([p, c]) => [p, c]));
}

// ---- XML well-formedness (no DOMParser needed) ------------------------------------------------
export function checkXml(text) {
	const s = String(text); const stack = []; let i = 0; const line = (pos) => s.slice(0, pos).split("\n").length;
	let sawRoot = false;
	while (i < s.length) {
		const lt = s.indexOf("<", i); if (lt < 0) { if (s.slice(i).trim() && stack.length === 0 && sawRoot) return { ok: false, error: `Text after the root element (line ${line(i)})` }; break; }
		if (s.startsWith("<!--", lt)) { const e = s.indexOf("-->", lt + 4); if (e < 0) return { ok: false, error: `Unterminated comment (line ${line(lt)})` }; i = e + 3; continue; }
		if (s.startsWith("<![CDATA[", lt)) { const e = s.indexOf("]]>", lt); if (e < 0) return { ok: false, error: `Unterminated CDATA (line ${line(lt)})` }; i = e + 3; continue; }
		if (s.startsWith("<?", lt)) { const e = s.indexOf("?>", lt); if (e < 0) return { ok: false, error: `Unterminated declaration (line ${line(lt)})` }; i = e + 2; continue; }
		if (s.startsWith("<!", lt)) { const e = s.indexOf(">", lt); if (e < 0) return { ok: false, error: `Unterminated declaration (line ${line(lt)})` }; i = e + 1; continue; }
		let j = lt + 1; let q = null;
		while (j < s.length) { const c = s[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === ">") break; j++; }
		if (j >= s.length) return { ok: false, error: `Unterminated tag (line ${line(lt)})` };
		const body = s.slice(lt + 1, j);
		if (body.startsWith("/")) { const name = body.slice(1).trim(); const top = stack.pop(); if (top !== name) return { ok: false, error: `Mismatched closing tag </${name}>${top ? `, expected </${top}>` : ""} (line ${line(lt)})` }; }
		else {
			const m = /^([^\s/>]+)([\s\S]*?)(\/?)$/.exec(body); if (!m) return { ok: false, error: `Bad tag (line ${line(lt)})` };
			if (stack.length === 0 && sawRoot) return { ok: false, error: `More than one root element (line ${line(lt)})` };
			sawRoot = true;
			const attrs = m[2]; const re = /\s+([^\s=]+)\s*=\s*("[^"]*"|'[^']*')/g; let rest = attrs; rest = rest.replace(re, ""); if (rest.trim()) return { ok: false, error: `Malformed attribute near "${rest.trim().slice(0, 20)}" (line ${line(lt)})` };
			if (!m[3]) stack.push(m[1]);
		}
		i = j + 1;
	}
	if (!sawRoot) return { ok: false, error: "No root element" };
	if (stack.length) return { ok: false, error: `Unclosed <${stack.at(-1)}>` };
	return { ok: true };
}

/** Android-specific manifest checks on top of well-formedness. Returns a list of problems (empty = fine). */
export function validateManifest(xml) {
	const wf = checkXml(xml); if (!wf.ok) return [wf.error];
	const p = [];
	if (!/<manifest[\s>]/.test(xml)) p.push("Root element must be <manifest>");
	if (!/<application[\s>/]/.test(xml)) p.push("Missing <application> element");
	const acts = [...xml.matchAll(/<activity\b([\s\S]*?)(\/>|>[\s\S]*?<\/activity>)/g)];
	if (!acts.length) p.push("No <activity> declared");
	let launcher = false;
	for (const a of acts) {
		const hasFilter = /<intent-filter/.test(a[0]);
		if (hasFilter && !/android:exported\s*=/.test(a[1])) p.push(`Activity ${/android:name="([^"]+)"/.exec(a[1])?.[1] || "?"} has an intent-filter but no android:exported (required for Android 12+)`);
		if (/android\.intent\.action\.MAIN/.test(a[0]) && /android\.intent\.category\.LAUNCHER/.test(a[0])) launcher = true;
	}
	if (acts.length && !launcher) p.push("No launcher activity (MAIN + LAUNCHER intent-filter)");
	return p;
}

// ---- Gradle (Kotlin DSL) value reading/writing ------------------------------------------------
const KEYS = { applicationId: /(applicationId\s*=\s*)"([^"]*)"/, versionName: /(versionName\s*=\s*)"([^"]*)"/, versionCode: /(versionCode\s*=\s*)(\d+)/, minSdk: /(minSdk\s*=\s*)(\d+)/, targetSdk: /(targetSdk\s*=\s*)(\d+)/, compileSdk: /(compileSdk\s*=\s*)(\d+)/, namespace: /(namespace\s*=\s*)"([^"]*)"/ };
export function readGradleValues(text) { const out = {}; for (const [k, re] of Object.entries(KEYS)) { const m = re.exec(text); if (m) out[k] = m[2]; } return out; }
export function setGradleValue(text, key, value) {
	const re = KEYS[key]; if (!re) throw new Error(`Unsupported setting ${key}`);
	const numeric = ["versionCode", "minSdk", "targetSdk", "compileSdk"].includes(key);
	if (numeric && !/^\d{1,9}$/.test(String(value))) throw new Error(`${key} must be a whole number`);
	if (key === "applicationId" || key === "namespace") validatePackageName(value);
	if (key === "versionName" && !/^[\w.+-]{1,40}$/.test(String(value))) throw new Error("versionName may contain letters, digits and . _ + -");
	if (!re.test(text)) throw new Error(`${key} is not present in this file`);
	return text.replace(re, (_m, pre) => `${pre}${numeric ? value : `"${value}"`}`);
}
/** Groups project files for the structure/resource viewer. */
export function describeStructure(paths) {
	const res = {}; const src = []; const gradle = []; let manifest = null;
	for (const p of paths) {
		if (p.endsWith("AndroidManifest.xml")) manifest = p;
		else if (/\.gradle(\.kts)?$/.test(p)) gradle.push(p);
		else if (/\/src\/[^/]+\/(java|kotlin)\//.test(`/${p}`) && /\.(kt|java)$/.test(p)) src.push(p);
		else { const m = /\/res\/([^/]+)\//.exec(`/${p}`); if (m) (res[m[1].split("-")[0]] ||= []).push(p); }
	}
	return { manifest, gradle, sources: src, resources: res };
}
