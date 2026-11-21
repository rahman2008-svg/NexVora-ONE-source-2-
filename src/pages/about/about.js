import "./about.scss";
import Logo from "components/logo";
import Page from "components/page";
import Reactive from "html-tag-js/reactive";
import actionStack from "lib/actionStack";
import config from "lib/config";
import helpers from "utils/helpers";

const UPSTREAM_URL = "https://github.com/Acode-Foundation/Acode";
const UPSTREAM_LICENSE = `NexVora ONE is built on Acode.

Copyright 2020 Foxdebug (Ajit Kumar)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Full third-party dependency licenses are listed in package.json and the project's node_modules / plugin directories.`;

function openUrl(url) {
	return (e) => {
		e.preventDefault();
		system.openInBrowser(url);
	};
}

export default function AboutInclude() {
	const $page = Page(strings.about.capitalize());
	const webviewVersionName = Reactive("N/A");
	const webviewPackageName = Reactive("N/A");

	$page.classList.add("about-us");
	$page.body = (
		<main id="about-page" className="main scroll">
			<Logo />

			<div className="version-info">
				<h1 className="version-title">NexVora ONE</h1>
				<div className="version-number">
					Version {BuildInfo.version} ({BuildInfo.versionCode})
				</div>
				<div className="version-number">Build Anything. Anywhere.</div>
			</div>

			<div className="info-section">
				<a href="#" className="info-item" onclick={openUrl(config.GITHUB_URL)}>
					<div className="info-item-icon">
						<span className="icon github"></span>
					</div>
					<div className="info-item-text">
						Source code
						<div className="info-item-subtext">{config.GITHUB_URL}</div>
					</div>
				</a>
				<a href="#" className="info-item" onclick={openUrl(UPSTREAM_URL)}>
					<div className="info-item-icon">
						<span className="icon code"></span>
					</div>
					<div className="info-item-text">
						Based on Acode (MIT License)
						<div className="info-item-subtext">{UPSTREAM_URL}</div>
					</div>
				</a>
				<a
					href="#"
					className="info-item"
					onclick={(e) => {
						e.preventDefault();
						system.openInBrowser(
							`https://play.google.com/store/apps/details?id=${webviewPackageName.value}`,
						);
					}}
				>
					<div className="info-item-icon">
						<span className="icon googlechrome"></span>
					</div>
					<div className="info-item-text">
						Webview {webviewVersionName}
						<div className="info-item-subtext">{webviewPackageName}</div>
					</div>
				</a>
			</div>

			<div className="info-section">
				<div className="info-item">
					<div className="info-item-text">
						Developed by Prince AR Abdur Rahman
						<div className="info-item-subtext">Published by NexVora Lab's Ofc</div>
						<div className="info-item-subtext">
							© 2026 NexVora Lab's Ofc. All Rights Reserved.
						</div>
					</div>
				</div>
			</div>

			<div className="info-section">
				<div className="info-item">
					<div className="info-item-text">
						Open-source licenses
						<pre
							className="info-item-subtext"
							style={{ whiteSpace: "pre-wrap", userSelect: "text" }}
						>
							{UPSTREAM_LICENSE}
						</pre>
					</div>
				</div>
			</div>
		</main>
	);

	system.getWebviewInfo((res) => {
		webviewPackageName.value = res?.packageName || "N/A";
		webviewVersionName.value = res?.versionName || "N/A";
	});

	actionStack.push({
		id: "about",
		action: $page.hide,
	});

	$page.onhide = function () {
		actionStack.remove("about");
	};

	app.append($page);
	helpers.showAd();
}
