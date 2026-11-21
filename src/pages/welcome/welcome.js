import logoSrc from "components/logo/logo.png?inline";
import config from "lib/config";
import EditorFile from "lib/editorFile";

const VERSION = "1.0.0";

/**
 * Opens the NexVora ONE Home dashboard as an EditorFile page.
 */
export default function openWelcomeTab() {
	const existingFile = editorManager.files.find((f) => f.id === "welcome-tab");
	if (existingFile) {
		existingFile.makeActive();
		return;
	}

	const file = new EditorFile("Home", {
		id: "welcome-tab",
		render: true,
		type: "page",
		content: createDashboard(),
		tabIcon: "icon acode",
		hideQuickTools: true,
	});
	file.setCustomTitle(() => "NexVora ONE");
}

function runActiveFile() {
	const file = editorManager.activeFile;
	if (!file || file.type !== "editor") {
		window.toast("Open an HTML file in Code Studio first, then run it.", 3500);
		return;
	}
	acode.exec("run");
}

function createDashboard() {
	/** @type {{icon:string,label:string,onClick:()=>void}[]} */
	const quickAccess = [
		{ icon: "code", label: "Code Studio", onClick: () => acode.exec("open-folder") },
		{ icon: "public", label: "Web Studio", onClick: runActiveFile },
		{ icon: "terminal", label: "Terminal", onClick: () => acode.exec("new-terminal") },
		{ icon: "extension", label: "Extensions", onClick: () => acode.exec("open", "plugins") },
		{
			icon: "brain",
			label: "AI Studio",
			onClick: async () => (await import("pages/ai")).default(),
		},
		{
			icon: "send",
			label: "Deploy",
			onClick: async () => (await import("pages/deploy")).default(),
		},
		{ icon: "folder_open", label: "Projects", onClick: async () => (await import("pages/projects")).default() },
		{ icon: "phone_android", label: "App Studio", onClick: async () => (await import("pages/appstudio")).default() },
		{
			icon: "git",
			label: "Git Studio",
			onClick: async () => (await import("pages/git")).default(),
		},
		{
			icon: "sd_storage",
			label: "Database",
			onClick: async () => (await import("pages/database")).default(),
		},
		{
			icon: "cloud",
			label: "API Studio",
			onClick: async () => (await import("pages/apiStudio")).default(),
		},
		{
			icon: "tune",
			label: "Toolbox",
			onClick: async () => (await import("pages/toolbox")).default(),
		},
		{ icon: "color_lenspalette", label: "Themes", onClick: () => acode.exec("change-app-theme") },
		{ icon: "settings", label: "Settings", onClick: () => acode.exec("open", "settings") },
	];

	return (
		<div id="welcome-tab" className="nx-home scroll">
			<header className="nx-hero">
				<img className="nx-logo" src={logoSrc} width="72" height="72" alt="" />
				<h1>
					NexVora <span>ONE</span>
				</h1>
				<p className="nx-tagline">Build Anything. Anywhere.</p>
			</header>

			<section className="nx-welcome" onclick={() => acode.exec("open", "settings")}>
				<span className="nx-avatar">P</span>
				<div className="nx-welcome-text">
					<strong>Welcome Back!</strong>
					<small>Prince AR Abdur Rahman</small>
				</div>
				<span className="icon keyboard_arrow_right"></span>
			</section>

			<section className="nx-section">
				<div className="nx-section-head">
					<h2>Quick Access</h2>
				</div>
				<div className="nx-grid">
					{quickAccess.map((item) => (
						<button
							type="button"
							className="nx-card"
							onclick={item.onClick}
						>
							<span className={`icon ${item.icon}`}></span>
							<span className="nx-card-label">{item.label}</span>
						</button>
					))}
				</div>
			</section>

			<section className="nx-section">
				<div className="nx-section-head">
					<h2>Start</h2>
				</div>
				<div className="nx-list">
					<ListRow icon="add" label="New file" onClick={() => acode.exec("new-file")} />
					<ListRow icon="document-text-outline" label="Open file" onClick={() => acode.exec("open-file")} />
					<ListRow icon="folder_open" label="Open folder" onClick={() => acode.exec("open-folder")} />
					<ListRow icon="historyrestore" label="Recent" onClick={() => acode.exec("recent")} />
					<ListRow icon="color_lenspalette" label="Change theme" onClick={() => acode.exec("change-app-theme")} />
					<ListRow icon="info_outline" label="About NexVora ONE" onClick={() => acode.exec("open", "about")} />
				</div>
			</section>

			<nav className="nx-bottom-nav">
				<NavItem icon="home" label="Home" active onClick={() => document.querySelector("#welcome-tab")?.scrollTo?.({ top: 0, behavior: "smooth" })} />
				<NavItem icon="folder_open" label="Projects" onClick={async () => (await import("pages/projects")).default()} />
				<NavItem icon="tune" label="Tools" onClick={async () => (await import("pages/toolbox")).default()} />
				<NavItem icon="github" label="GitHub" onClick={async () => (await import("pages/accounts")).default()} />
				<NavItem icon="settings" label="Settings" onClick={() => acode.exec("open", "settings")} />
			</nav>
			<footer className="nx-footer">
				<p>Developed by Prince AR Abdur Rahman</p>
				<p>Published by NexVora Lab's Ofc</p>
				<p>© 2026 NexVora Lab's Ofc. All Rights Reserved.</p>
				<a
					href={config.GITHUB_URL}
					onclick={(e) => {
						e.preventDefault();
						system.openInBrowser(config.GITHUB_URL);
					}}
				>
					Source code on GitHub
				</a>
			</footer>
		</div>
	);
}

function NavItem({ icon, label, onClick, active }) {
	return (
		<button type="button" className={`nx-nav-item${active ? " active" : ""}`} onclick={onClick}>
			<span className={`icon ${icon}`}></span>
			<span>{label}</span>
		</button>
	);
}

function ListRow({ icon, label, onClick }) {
	return (
		<div className="nx-row" onclick={onClick}>
			<span className={`icon ${icon}`}></span>
			<span>{label}</span>
			<span className="icon keyboard_arrow_right"></span>
		</div>
	);
}
