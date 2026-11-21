import alert from "dialogs/alert";

const KEY = "nexvora.onboarded.v1";
export const hasOnboarded = () => window.localStorage.getItem(KEY) === "1";
export const markOnboarded = () => window.localStorage.setItem(KEY, "1");

export const SLIDES = [
	{ title: "Welcome to NexVora ONE", body: "Build Anything. Anywhere.\nA code editor, Linux terminal, Git, local AI, SQLite, API testing, deployment helpers and developer tools - on your phone." },
	{ title: "Your data stays with you", body: "No ads, no analytics, no account required. Projects are stored on your device and are never uploaded automatically." },
	{ title: "Your own accounts", body: "GitHub, GitLab, Bitbucket, Vercel and Render can be connected with YOUR OWN account in Settings → Connected accounts. Tokens are stored encrypted on this device. Nothing is shared between users." },
	{ title: "Permissions we will ask for", body: "Storage (Android 12 and older): to open and save the files and folders you choose.\nNotifications: to show the terminal / local server status while they run.\nNetwork: the extension store, and the servers YOU configure (Git hosts, APIs, AI server). Plain HTTP is only allowed to this device itself." },
];

/** Shows the slides one by one (before any permission prompt). Resolves when finished. */
export async function runOnboarding() {
	if (hasOnboarded()) return;
	for (const [i, s] of SLIDES.entries()) {
		await new Promise((resolve) => alert(`${s.title} (${i + 1}/${SLIDES.length})`, s.body.replace(/\n/g, "<br>"), resolve));
	}
	markOnboarded();
}
