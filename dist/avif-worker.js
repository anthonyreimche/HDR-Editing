//#region src/av1-seq.ts
var e = class extends Error {}, t = class {
	constructor(e, t, n) {
		this.bytes = e, this.end = n, this.at = t * 8;
	}
	get position() {
		return this.at;
	}
	read(t) {
		let n = 0;
		for (let r = 0; r < t; r++) {
			if (this.at >= this.end * 8) throw new e();
			n = n * 2 + (this.bytes[this.at >> 3] >> 7 - (this.at & 7) & 1), this.at++;
		}
		return n;
	}
	uvlc() {
		let e = 0;
		for (; this.read(1) === 0;) e++;
		return e >= 32 ? 4294967295 : this.read(e) + 2 ** e - 1;
	}
};
function n(e, n, r) {
	let i = new t(e, n, r), a = i.read(3);
	i.read(1);
	let o = i.read(1) === 1;
	if (o) i.read(5);
	else {
		let e = !1, t = 0;
		i.read(1) === 1 && (i.read(32), i.read(32), i.read(1) === 1 && i.uvlc(), e = i.read(1) === 1, e && (t = i.read(5) + 1, i.read(32), i.read(5), i.read(5)));
		let n = i.read(1) === 1, r = i.read(5) + 1;
		for (let a = 0; a < r; a++) i.read(12), i.read(5) > 7 && i.read(1), e && i.read(1) === 1 && (i.read(t), i.read(t), i.read(1)), n && i.read(1) === 1 && i.read(4);
	}
	let s = i.read(4) + 1, c = i.read(4) + 1;
	if (i.read(s), i.read(c), !o && i.read(1) === 1 && (i.read(4), i.read(3)), i.read(3), !o) {
		i.read(4);
		let e = i.read(1) === 1;
		e && i.read(2), (i.read(1) === 1 || i.read(1) === 1) && i.read(1) === 0 && i.read(1), e && i.read(3);
	}
	if (i.read(3), a > 2) return null;
	let l = i.read(1) === 1;
	return a === 2 && l && i.read(1), a !== 1 && i.read(1), i.read(1) === 0 ? null : {
		bit: i.position,
		primaries: i.read(8),
		transfer: i.read(8),
		matrix: i.read(8)
	};
}
function r(e, t, n) {
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
function i(t, i, a) {
	try {
		let e = i;
		for (; e < a;) {
			let i = t[e];
			if (i & 128) return null;
			let o = i >> 3 & 15, s = e + 1 + (i & 4 ? 1 : 0), c = a - s;
			if (i & 2) {
				let e = r(t, s, a);
				if (!e) return null;
				c = e.value, s += e.length;
			}
			if (c < 0 || s + c > a) return null;
			if (o === 1) return n(t, s, s + c);
			e = s + c;
		}
		return null;
	} catch (t) {
		if (t instanceof e) return null;
		throw t;
	}
}
function a(e, t, n, r) {
	for (let i = 0; i < n; i++) {
		let a = t + i, o = 128 >> (a & 7);
		Math.floor(r / 2 ** (n - 1 - i)) % 2 == 1 ? e[a >> 3] |= o : e[a >> 3] &= ~o;
	}
}
var o = (e) => Number.isInteger(e) && e >= 0 && e <= 255, s = (e, t) => e === 1 && t === 13;
function c(e, t, n, r, c) {
	if (!o(r) || !o(c)) return !1;
	let l = i(e, t, n);
	return !l || l.matrix === 0 && (s(l.primaries, l.transfer) || s(r, c)) ? !1 : (a(e, l.bit, 8, r), a(e, l.bit + 8, 8, c), !0);
}
//#endregion
//#region src/avif-box.ts
var l = (e, t) => String.fromCharCode(e[t], e[t + 1], e[t + 2], e[t + 3]);
function u(e, t, n) {
	let r = new DataView(e.buffer, e.byteOffset, e.byteLength), i = [], a = t;
	for (; a + 8 <= n;) {
		let t = r.getUint32(a), o = 8;
		if (t === 1) {
			if (a + 16 > n) break;
			t = Number(r.getBigUint64(a + 8)), o = 16;
		} else t === 0 && (t = n - a);
		if (t < o || a + t > n) break;
		i.push({
			type: l(e, a + 4),
			content: a + o,
			end: a + t
		}), a += t;
	}
	return i;
}
var d = 11;
function f(e) {
	let t = u(e, 0, e.length).find((e) => e.type === "meta");
	if (!t) return null;
	let n = u(e, t.content + 4, t.end).find((e) => e.type === "iprp"), r = n && u(e, n.content, n.end).find((e) => e.type === "ipco"), i = r && u(e, r.content, r.end).find((t) => t.type === "colr" && t.end - t.content >= d && l(e, t.content) === "nclx");
	return i ? i.content + 4 : null;
}
function p(e, t = 9, n = 16) {
	let r = f(e);
	if (r === null) return !1;
	let i = new DataView(e.buffer, e.byteOffset, e.byteLength);
	return i.setUint16(r, t), i.setUint16(r + 2, n), !0;
}
var m = class extends Error {}, h = class {
	constructor(e, t, n) {
		this.bytes = e, this.end = n, this.at = t;
	}
	read(e) {
		if (this.at + e > this.end) throw new m();
		let t = 0;
		for (let n = 0; n < e; n++) t = t * 256 + this.bytes[this.at++];
		return t;
	}
}, g = [
	0,
	4,
	8
];
function _(e) {
	let t = u(e, 0, e.length).find((e) => e.type === "meta");
	if (!t) return null;
	let n = u(e, t.content + 4, t.end), r = n.find((e) => e.type === "pitm"), i = n.find((e) => e.type === "iloc");
	if (!r || !i) return null;
	try {
		let t = new h(e, r.content, r.end), n = t.read(1);
		t.read(3);
		let a = t.read(n === 0 ? 2 : 4), o = new h(e, i.content, i.end), s = o.read(1);
		if (o.read(3), s > 2) return null;
		let c = o.read(2), l = c >> 12, u = c >> 8 & 15, d = c >> 4 & 15, f = s === 0 ? 0 : c & 15;
		if (![
			l,
			u,
			d
		].every((e) => g.includes(e)) || !(f === 0 || g.includes(f))) return null;
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
		if (e instanceof m) return null;
		throw e;
	}
}
function v(e, t = 9, n = 16) {
	let r = _(e);
	return r !== null && c(e, r.start, r.end, t, n);
}
//#endregion
//#region src/avif.ts
var y = null;
function b(e) {
	if (!y) {
		let t = (async () => {
			let [t, n] = await Promise.all([e.factory(), e.wasm()]);
			return {
				factory: t,
				compiled: await WebAssembly.compile(n)
			};
		})();
		y = t, t.catch(() => {
			y === t && (y = null);
		});
	}
	return y;
}
function x({ factory: e, compiled: t }) {
	let n = () => {}, r = new Promise((e, t) => {
		n = t;
	}), i = e({
		noInitialRun: !0,
		locateFile: (e) => e,
		instantiateWasm: (e, r) => (WebAssembly.instantiate(t, e).then(r).catch(n), {})
	});
	return Promise.race([i, r]);
}
async function S(e) {
	let t = b(e), n = await t;
	try {
		return await x(n);
	} catch (e) {
		throw y === t && (y = null), e;
	}
}
async function C(e, t, n, r, i) {
	if (e.byteOffset !== 0 || e.byteLength !== e.buffer.byteLength) throw Error("[hdr-editing] AVIF input must own its whole buffer");
	let a = (await S(i)).encode(new Uint8Array(e.buffer), t, n, {
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
async function w(e, t, n, r, i) {
	let a = await C(e, t, n, r, i);
	if (!p(a)) throw Error("[hdr-editing] the AVIF has no colour box to mark as PQ");
	return v(a), a;
}
function T(e) {
	return {
		factory: () => import(
			/* @vite-ignore */
			e.glue
).then((e) => e.default),
		wasm: () => fetch(e.wasm).then((e) => {
			if (!e.ok) throw Error(`[hdr-editing] AVIF encoder unavailable (${e.status})`);
			return e.arrayBuffer();
		})
	};
}
//#endregion
//#region src/model.ts
var E = 1 / 64;
function D(e) {
	return e < .04045 ? e / 12.92 : ((e + .055) / 1.055) ** 2.4;
}
function O(e) {
	return Math.floor(Math.min(4, Math.max(.5, e)) * 10 + .5) / 10;
}
//#endregion
//#region src/frame.ts
var k = Float64Array.from({ length: 256 }, (e, t) => D(t / 255)), A = 2610 / 16384, j = 78.84375, M = 3424 / 4096, N = 18.8515625, P = 18.6875;
function F(e) {
	let t = Math.min(1, Math.max(0, e)) ** +A;
	return ((M + N * t) / (1 + P * t)) ** +j;
}
var I = [
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
function L(e, t) {
	if (t.width !== e.width || t.height !== e.height) throw Error(`[hdr-editing] the gain map is ${t.width}x${t.height}, the image ${e.width}x${e.height}`);
}
var R = null;
function z() {
	if (R) return R;
	let e = (e) => Math.round(F(e) * 1023), t = /* @__PURE__ */ new Float64Array(1024);
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
	return R = t, t;
}
function B(e, t) {
	let n = Math.max(e, 0) * 203 / 1e4, r = 0, i = 1024;
	for (; i - r > 1;) {
		let e = r + i >> 1;
		n >= t[e] ? r = e : i = e;
	}
	return r;
}
function V(e, t, n) {
	L(e, t);
	let r = O(n), i = Float64Array.from({ length: 256 }, (e, t) => 2 ** (t / 255 * r)), a = z(), [o, s, c, l, u, d, f, p, m] = I, h = e.data, g = e.width * e.height, _ = new Uint16Array(g * 4);
	for (let e = 0; e < g * 4; e += 4) {
		let n = i[t.data[e]], r = (k[h[e]] + E) * n - E, g = (k[h[e + 1]] + E) * n - E, v = (k[h[e + 2]] + E) * n - E;
		_[e] = B(o * r + s * g + c * v, a), _[e + 1] = B(l * r + u * g + d * v, a), _[e + 2] = B(f * r + p * g + m * v, a), _[e + 3] = 1023;
	}
	return _;
}
//#endregion
//#region src/avif-job.ts
async function H(e, t) {
	try {
		let { sdr: n, gain: r } = e, i = await w(V(n, r, e.headroom), n.width, n.height, e.quality, t);
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
function U(e, t) {
	e.onmessage = ({ data: n }) => {
		H(n, t(n.encoder)).then((t) => e.postMessage(t, "avif" in t && t.avif.buffer instanceof ArrayBuffer ? [t.avif.buffer] : []));
	};
}
//#endregion
//#region src/avif-worker.ts
U(self, T);
//#endregion

//# sourceMappingURL=avif-worker.js.map