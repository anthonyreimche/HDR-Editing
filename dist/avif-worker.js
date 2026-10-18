//#region src/model.ts
var e = 1 / 64;
function t(e) {
	return e < .04045 ? e / 12.92 : ((e + .055) / 1.055) ** 2.4;
}
function n(e) {
	return Math.floor(Math.min(4, Math.max(.5, e)) * 10 + .5) / 10;
}
//#endregion
//#region src/params.ts
var r = "hdr-editing", i = `${r}.gain`;
`${r}`, `${r}`, `${r}`;
var a = [
	{
		key: "on",
		type: "float",
		def: 0,
		min: 0,
		max: 1,
		step: 1,
		label: "HDR"
	},
	{
		key: "headroom",
		type: "float",
		def: 2,
		min: .5,
		max: 4,
		step: .1,
		label: "Headroom"
	},
	{
		key: "start",
		type: "float",
		def: -.25,
		min: -3,
		max: 0,
		step: .05,
		label: "Start"
	},
	{
		key: "rolloff",
		type: "float",
		def: 1.5,
		min: .5,
		max: 4,
		step: .1,
		label: "Roll-off"
	},
	{
		key: "protection",
		type: "float",
		def: 50,
		min: 0,
		max: 100,
		step: 1,
		label: "Highlight protection"
	},
	{
		key: "mode",
		type: "int",
		def: 0,
		min: 0,
		max: 1,
		step: 1,
		label: "Output"
	}
], o = Object.fromEntries(a.map((e) => [e.key, `${i}.${e.key}`]));
o.mode;
var s = (e) => a.find((t) => t.key === e);
function c(e, t) {
	let n = s(t), r = e[o[t]];
	return typeof r != "number" || !Number.isFinite(r) ? n.def : Math.min(n.max, Math.max(n.min, r));
}
function l(e) {
	return {
		on: c(e, "on") > .5,
		headroom: n(c(e, "headroom")),
		start: c(e, "start"),
		rolloff: c(e, "rolloff"),
		protection: c(e, "protection")
	};
}
l({});
//#endregion
//#region src/asset-url.ts
function u(e) {
	return `${location.origin}/__plugins__/${r}/${e}?v=1.0.0`;
}
//#endregion
//#region src/av1-seq.ts
var d = 1, f = class extends Error {}, p = class {
	constructor(e, t, n) {
		this.bytes = e, this.end = n, this.at = t * 8;
	}
	get position() {
		return this.at;
	}
	read(e) {
		let t = 0;
		for (let n = 0; n < e; n++) {
			if (this.at >= this.end * 8) throw new f();
			t = t * 2 + (this.bytes[this.at >> 3] >> 7 - (this.at & 7) & 1), this.at++;
		}
		return t;
	}
	uvlc() {
		let e = 0;
		for (; this.read(1) === 0;) e++;
		return e >= 32 ? 4294967295 : this.read(e) + 2 ** e - 1;
	}
};
function m(e, t, n) {
	let r = new p(e, t, n), i = r.read(3);
	r.read(1);
	let a = r.read(1) === 1;
	if (a) r.read(5);
	else {
		let e = !1, t = 0;
		r.read(1) === 1 && (r.read(32), r.read(32), r.read(1) === 1 && r.uvlc(), e = r.read(1) === 1, e && (t = r.read(5) + 1, r.read(32), r.read(5), r.read(5)));
		let n = r.read(1) === 1, i = r.read(5) + 1;
		for (let a = 0; a < i; a++) r.read(12), r.read(5) > 7 && r.read(1), e && r.read(1) === 1 && (r.read(t), r.read(t), r.read(1)), n && r.read(1) === 1 && r.read(4);
	}
	let o = r.read(4) + 1, s = r.read(4) + 1;
	if (r.read(o), r.read(s), !a && r.read(1) === 1 && (r.read(4), r.read(3)), r.read(3), !a) {
		r.read(4);
		let e = r.read(1) === 1;
		e && r.read(2), (r.read(1) === 1 || r.read(1) === 1) && r.read(1) === 0 && r.read(1), e && r.read(3);
	}
	if (r.read(3), i > 2) return null;
	let c = r.read(1) === 1;
	return i === 2 && c && r.read(1), i !== 1 && r.read(1), r.read(1) === 0 ? null : {
		bit: r.position,
		primaries: r.read(8),
		transfer: r.read(8),
		matrix: r.read(8)
	};
}
function h(e, t, n) {
	let r = 0;
	for (let i = 0; i < 8; i++) {
		if (t + i >= n) return null;
		let a = e[t + i];
		if (r += (a & 127) * 2 ** (7 * i), !(a & 128)) return {
			value: r,
			length: i + 1
		};
	}
	return null;
}
function g(e, t, n) {
	try {
		let r = t;
		for (; r < n;) {
			let t = e[r];
			if (t & 128) return null;
			let i = t >> 3 & 15, a = r + 1 + (t & 4 ? 1 : 0), o = n - a;
			if (t & 2) {
				let t = h(e, a, n);
				if (!t) return null;
				o = t.value, a += t.length;
			}
			if (o < 0 || a + o > n) return null;
			if (i === d) return m(e, a, a + o);
			r = a + o;
		}
		return null;
	} catch (e) {
		if (e instanceof f) return null;
		throw e;
	}
}
function _(e, t, n, r) {
	for (let i = 0; i < n; i++) {
		let a = t + i, o = 128 >> (a & 7);
		Math.floor(r / 2 ** (n - 1 - i)) % 2 == 1 ? e[a >> 3] |= o : e[a >> 3] &= ~o;
	}
}
var v = (e) => Number.isInteger(e) && e >= 0 && e <= 255, y = (e, t) => e === 1 && t === 13;
function b(e, t, n, r, i) {
	if (!v(r) || !v(i)) return !1;
	let a = g(e, t, n);
	return !a || a.matrix === 0 && (y(a.primaries, a.transfer) || y(r, i)) ? !1 : (_(e, a.bit, 8, r), _(e, a.bit + 8, 8, i), !0);
}
//#endregion
//#region src/avif-box.ts
var x = (e, t) => String.fromCharCode(e[t], e[t + 1], e[t + 2], e[t + 3]);
function S(e, t, n) {
	let r = new DataView(e.buffer, e.byteOffset, e.byteLength), i = [], a = t;
	for (; a + 8 <= n;) {
		let t = r.getUint32(a), o = 8;
		if (t === 1) {
			if (a + 16 > n) break;
			t = Number(r.getBigUint64(a + 8)), o = 16;
		} else t === 0 && (t = n - a);
		if (t < o || a + t > n) break;
		i.push({
			type: x(e, a + 4),
			content: a + o,
			end: a + t
		}), a += t;
	}
	return i;
}
var C = 11;
function w(e) {
	let t = S(e, 0, e.length).find((e) => e.type === "meta");
	if (!t) return null;
	let n = S(e, t.content + 4, t.end).find((e) => e.type === "iprp"), r = n && S(e, n.content, n.end).find((e) => e.type === "ipco"), i = r && S(e, r.content, r.end).find((t) => t.type === "colr" && t.end - t.content >= C && x(e, t.content) === "nclx");
	return i ? i.content + 4 : null;
}
function T(e, t = 9, n = 16) {
	let r = w(e);
	if (r === null) return !1;
	let i = new DataView(e.buffer, e.byteOffset, e.byteLength);
	return i.setUint16(r, t), i.setUint16(r + 2, n), !0;
}
var E = class extends Error {}, D = class {
	constructor(e, t, n) {
		this.bytes = e, this.end = n, this.at = t;
	}
	read(e) {
		if (this.at + e > this.end) throw new E();
		let t = 0;
		for (let n = 0; n < e; n++) t = t * 256 + this.bytes[this.at++];
		return t;
	}
}, O = [
	0,
	4,
	8
];
function k(e) {
	let t = S(e, 0, e.length).find((e) => e.type === "meta");
	if (!t) return null;
	let n = S(e, t.content + 4, t.end), r = n.find((e) => e.type === "pitm"), i = n.find((e) => e.type === "iloc");
	if (!r || !i) return null;
	try {
		let t = new D(e, r.content, r.end), n = t.read(1);
		t.read(3);
		let a = t.read(n === 0 ? 2 : 4), o = new D(e, i.content, i.end), s = o.read(1);
		if (o.read(3), s > 2) return null;
		let c = o.read(2), l = c >> 12, u = c >> 8 & 15, d = c >> 4 & 15, f = s === 0 ? 0 : c & 15;
		if (![
			l,
			u,
			d
		].every((e) => O.includes(e)) || !(f === 0 || O.includes(f))) return null;
		let p = s === 2, m = o.read(p ? 4 : 2);
		for (let t = 0; t < m; t++) {
			let t = o.read(p ? 4 : 2), n = s === 0 ? 0 : o.read(2) & 15, r = o.read(2), i = o.read(d), c = o.read(2), m = null;
			for (let e = 0; e < c; e++) {
				o.read(f);
				let e = {
					offset: o.read(l),
					length: o.read(u)
				};
				m ??= e;
			}
			if (t !== a) continue;
			if (n !== 0 || r !== 0 || !m || m.length === 0) return null;
			let h = i + m.offset, g = h + m.length;
			return g <= e.length ? {
				start: h,
				end: g
			} : null;
		}
		return null;
	} catch (e) {
		if (e instanceof E) return null;
		throw e;
	}
}
function A(e, t = 9, n = 16) {
	let r = k(e);
	return r !== null && b(e, r.start, r.end, t, n);
}
//#endregion
//#region src/avif.ts
var j = null;
function M(e) {
	if (!j) {
		let t = (async () => {
			let [t, n] = await Promise.all([e.factory(), e.wasm()]);
			return {
				factory: t,
				compiled: await WebAssembly.compile(n)
			};
		})();
		j = t, t.catch(() => {
			j === t && (j = null);
		});
	}
	return j;
}
function N({ factory: e, compiled: t }) {
	let n = () => {}, r = new Promise((e, t) => {
		n = t;
	}), i = e({
		noInitialRun: !0,
		locateFile: (e) => e,
		instantiateWasm: (e, r) => (WebAssembly.instantiate(t, e).then(r).catch(n), {})
	});
	return Promise.race([i, r]);
}
async function P(e) {
	let t = M(e), n = await t;
	try {
		return await N(n);
	} catch (e) {
		throw j === t && (j = null), e;
	}
}
async function F(e, t, n, r, i) {
	if (e.byteOffset !== 0 || e.byteLength !== e.buffer.byteLength) throw Error("[hdr-editing] AVIF input must own its whole buffer");
	let a = (await P(i)).encode(new Uint8Array(e.buffer), t, n, {
		quality: r,
		qualityAlpha: -1,
		denoiseLevel: 0,
		tileColsLog2: 0,
		tileRowsLog2: 0,
		speed: 6,
		subsample: 1,
		chromaDeltaQ: !1,
		sharpness: 0,
		tune: 0,
		enableSharpYUV: !1,
		bitDepth: 10
	});
	if (!a) throw Error("[hdr-editing] AVIF encoding failed");
	return new Uint8Array(a);
}
async function I(e, t, n, r, i) {
	let a = await F(e, t, n, r, i);
	if (!T(a)) throw Error("[hdr-editing] the AVIF has no colour box to mark as PQ");
	return A(a), a;
}
function L() {
	return {
		factory: () => import(
			/* @vite-ignore */
			u("dist/avif_enc.js")
).then((e) => e.default),
		wasm: () => fetch(u("dist/avif_enc.wasm")).then((e) => {
			if (!e.ok) throw Error(`[hdr-editing] AVIF encoder unavailable (${e.status})`);
			return e.arrayBuffer();
		})
	};
}
//#endregion
//#region src/frame.ts
var R = Float64Array.from({ length: 256 }, (e, n) => t(n / 255)), z = 2610 / 16384, B = 78.84375, V = 3424 / 4096, H = 18.8515625, U = 18.6875;
function W(e) {
	let t = Math.min(1, Math.max(0, e)) ** +z;
	return ((V + H * t) / (1 + U * t)) ** +B;
}
var G = [
	.627404,
	.329283,
	.043313,
	.069097,
	.91954,
	.011362,
	.016391,
	.088013,
	.895595
];
function K(e, t) {
	if (t.width !== e.width || t.height !== e.height) throw Error(`[hdr-editing] the gain map is ${t.width}x${t.height}, the image ${e.width}x${e.height}`);
}
var q = null;
function J() {
	if (q) return q;
	let e = (e) => Math.round(W(e) * 1023), t = /* @__PURE__ */ new Float64Array(1024);
	t[0] = -Infinity;
	let n = 0;
	for (let r = 1; r < 1024; r++) {
		let i = 1;
		for (;;) {
			let t = n + (i - n) / 2;
			if (t === n || t === i) break;
			e(t) >= r ? i = t : n = t;
		}
		t[r] = i;
	}
	return q = t, t;
}
function Y(e, t) {
	let n = Math.max(e, 0) * 203 / 1e4, r = 0, i = 1024;
	for (; i - r > 1;) {
		let e = r + i >> 1;
		n >= t[e] ? r = e : i = e;
	}
	return r;
}
function X(t, r, i) {
	K(t, r);
	let a = n(i), o = Float64Array.from({ length: 256 }, (e, t) => 2 ** (t / 255 * a)), s = J(), [c, l, u, d, f, p, m, h, g] = G, _ = t.data, v = t.width * t.height, y = new Uint16Array(v * 4);
	for (let t = 0; t < v * 4; t += 4) {
		let n = o[r.data[t]], i = (R[_[t]] + e) * n - e, a = (R[_[t + 1]] + e) * n - e, v = (R[_[t + 2]] + e) * n - e;
		y[t] = Y(c * i + l * a + u * v, s), y[t + 1] = Y(d * i + f * a + p * v, s), y[t + 2] = Y(m * i + h * a + g * v, s), y[t + 3] = 1023;
	}
	return y;
}
//#endregion
//#region src/avif-job.ts
async function Z(e, t) {
	try {
		let { sdr: n, gain: r } = e, i = await I(X(n, r, e.headroom), n.width, n.height, e.quality, t);
		return {
			id: e.id,
			avif: i
		};
	} catch (t) {
		return {
			id: e.id,
			error: t instanceof Error ? t.message : String(t)
		};
	}
}
function Q(e, t) {
	e.onmessage = ({ data: n }) => {
		Z(n, t).then((t) => e.postMessage(t, "avif" in t && t.avif.buffer instanceof ArrayBuffer ? [t.avif.buffer] : []));
	};
}
//#endregion
//#region src/avif-worker.ts
Q(self, L());
//#endregion

//# sourceMappingURL=avif-worker.js.map