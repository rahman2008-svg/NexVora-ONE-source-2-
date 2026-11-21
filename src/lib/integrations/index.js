// App-level singleton wiring the integration layer to Android secure storage and HTTP.
import { cordovaTransport, fetchTransport } from "lib/apiStudio/request";
import { createAndroidSecureBackend, createCredentialStore, createMemoryBackend } from "./credentialStore.js";
import { createAccountManager } from "./registry.js";

let manager;
export function getAccountManager() {
	if (manager) return manager;
	const hasNative = !!window.cordova?.exec;
	const secure = hasNative ? createAndroidSecureBackend(window.cordova.exec.bind(window.cordova)) : createMemoryBackend();
	const store = createCredentialStore({ meta: window.localStorage, secure });
	const transport = window.cordova?.plugin?.http ? cordovaTransport(window.cordova.plugin.http) : fetchTransport;
	manager = createAccountManager({ store, transport });
	return manager;
}
