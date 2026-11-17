//#region src/index.ts
var origin = "https://xiaohe-demo-2026.colliderdoki.chatgpt.site";
//#endregion
//#region \0virtual:cloudflare/worker-entry
var worker_entry_default = { async fetch(request) {
	const url = new URL(request.url);
	if ([
		"/signin-with-chatgpt",
		"/callback",
		"/signout-with-chatgpt"
	].includes(url.pathname)) return new Response("请使用免登录演示入口。", { status: 403 });
	if (![
		"GET",
		"HEAD",
		"OPTIONS"
	].includes(request.method)) {
		const requestOrigin = request.headers.get("Origin");
		if (request.headers.get("Sec-Fetch-Site") === "cross-site" || requestOrigin && requestOrigin !== url.origin) return new Response("Forbidden", { status: 403 });
	}
	const target = new URL(url.pathname + url.search, origin);
	const headers = new Headers(request.headers);
	for (const name of Array.from(headers.keys())) if (name.toLowerCase().startsWith("oai-authenticated-user-")) headers.delete(name);
	headers.delete("host");
	if (headers.has("origin")) headers.set("Origin", origin);
	const upstream = await fetch(new Request(target, {
		method: request.method,
		headers,
		body: request.body,
		redirect: "manual"
	}));
	const output = new Headers(upstream.headers);
	const location = output.get("location");
	if (location && location.startsWith(origin)) output.set("location", url.origin + location.slice(50));
	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: output
	});
} };
//#endregion
export { worker_entry_default as default };

//# sourceMappingURL=index.js.map
