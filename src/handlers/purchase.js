// NexVora ONE has no in-app purchases. This inert listener only exists so the
// plugin-registry code paths for third-party paid plugins keep compiling; those
// paths are unreachable because helpers.isIapAvailable() always returns false.
export default function purchaseListener(_onpurchase, onerror) {
	const fail = () => onerror?.(new Error("Purchases are not supported."));
	return [() => {}, fail];
}
