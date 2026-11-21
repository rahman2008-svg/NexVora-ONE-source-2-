// NexVora ONE build configuration.
// Sets Babel compaction for the requested mode and writes the launcher/splash
// colour resources. The upstream free/paid variant switching (AdMob) was removed.
const fs = require("node:fs");
const path = require("node:path");

const APP_ID = "com.nexvora.one";
const LOGO_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#050714</color>
    <color name="ic_splash_background">#050714</color>
</resources>
`;

function configureProject({
	mode = "d",
	rootDir = path.resolve(__dirname, ".."),
	fsImpl = fs,
} = {}) {
	const babelPath = path.join(rootDir, ".babelrc");
	const logoPath = path.join(
		rootDir,
		"res/android/values/ic_launcher_background.xml",
	);
	const babelConfig = JSON.parse(fsImpl.readFileSync(babelPath, "utf8"));
	const compact = mode === "p" || mode === "prod";
	if (babelConfig.compact !== compact) {
		babelConfig.compact = compact;
		fsImpl.writeFileSync(
			babelPath,
			`${JSON.stringify(babelConfig, undefined, 2)}\n`,
			"utf8",
		);
	}
	fsImpl.writeFileSync(logoPath, LOGO_XML, "utf8");
	return { appId: APP_ID, compact };
}

if (require.main === module) {
	try {
		configureProject({ mode: process.argv[2] || "d" });
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
}

module.exports = { APP_ID, configureProject };
