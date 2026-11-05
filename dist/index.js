//#region src/model.ts
var e = 1 / 64, t = (e) => .2126 * e[0] + .7152 * e[1] + .0722 * e[2], n = (e) => e < 0 ? 0 : e > 1 ? 1 : e;
function r(e) {
	return e < .04045 ? e / 12.92 : ((e + .055) / 1.055) ** 2.4;
}
function i(e) {
	let t = n(e);
	return t < .0031308 ? t * 12.92 : 1.055 * t ** (1 / 2.4) - .055;
}
function a(e) {
	return Math.floor(Math.min(4, Math.max(.5, e)) * 10 + .5) / 10;
}
function o(t, n, r, i) {
	return (t + e) * 2 ** (n * a(r) * i) - e;
}
//#endregion
//#region src/params.ts
var s = "hdr-editing", c = `${s}.gain`, l = `${s}.panel`, u = `${s}.overlay`, d = `${s}.export`, f = [
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
], p = Object.fromEntries(f.map((e) => [e.key, `${c}.${e.key}`])), m = { [p.mode]: 1 }, h = (e) => f.find((t) => t.key === e);
function g(e, t) {
	let n = h(t), r = e[p[t]];
	return typeof r != "number" || !Number.isFinite(r) ? n.def : Math.min(n.max, Math.max(n.min, r));
}
function _(e) {
	return {
		on: g(e, "on") > .5,
		headroom: a(g(e, "headroom")),
		start: g(e, "start"),
		rolloff: g(e, "rolloff"),
		protection: g(e, "protection")
	};
}
var v = _({});
function y(e) {
	let t = {};
	return e.on !== void 0 && (t[p.on] = +!!e.on), e.headroom !== void 0 && (t[p.headroom] = e.headroom), e.start !== void 0 && (t[p.start] = e.start), e.rolloff !== void 0 && (t[p.rolloff] = e.rolloff), e.protection !== void 0 && (t[p.protection] = e.protection), t;
}
function b() {
	return y(v);
}
function x(e) {
	if (typeof e != "object" || !e) return !1;
	let t = e.processVersion;
	return typeof t == "number" && t >= 2;
}
//#endregion
//#region src/asset-url.ts
function S(e) {
	return `${location.origin}/__plugins__/${s}/${e}?v=1.0.1`;
}
//#endregion
//#region src/avif-worker-client.ts
function C() {
	return new Worker(S("dist/avif-worker.js"), { type: "module" });
}
var ee = (...e) => e.map((e) => e.data.buffer).filter((e) => e instanceof ArrayBuffer);
function w(e) {
	let t = null, n = 1, r = /* @__PURE__ */ new Map();
	function i(e) {
		t?.terminate(), t = null;
		let n = /* @__PURE__ */ Error(e ? `the AVIF worker stopped: ${e}` : "the AVIF worker stopped");
		for (let e of r.values()) e.reject(n);
		r.clear();
	}
	function a() {
		let n = e();
		return n.onmessage = ({ data: e }) => {
			let t = r.get(e.id);
			t && (r.delete(e.id), "avif" in e ? t.resolve(e.avif) : t.reject(Error(e.error)));
		}, n.onerror = (e) => {
			e.preventDefault(), t === n && i(e.message);
		}, n.onmessageerror = () => {
			t === n && i("an answer couldn't be read");
		}, n;
	}
	return {
		encode: (e, i, o, s) => new Promise((c, l) => {
			let u = n++;
			try {
				t ??= a(), r.set(u, {
					resolve: c,
					reject: l
				}), t.postMessage({
					id: u,
					sdr: e,
					gain: i,
					headroom: o,
					quality: s
				}, ee(e, i));
			} catch (e) {
				r.delete(u), l(e);
			}
		}),
		stop: () => i()
	};
}
var T = w(C), E = (e, t) => String.fromCharCode(e[t], e[t + 1], e[t + 2], e[t + 3]);
function D(e, t, n) {
	let r = new DataView(e.buffer, e.byteOffset, e.byteLength), i = [], a = t;
	for (; a + 8 <= n;) {
		let t = r.getUint32(a), o = 8;
		if (t === 1) {
			if (a + 16 > n) break;
			t = Number(r.getBigUint64(a + 8)), o = 16;
		} else t === 0 && (t = n - a);
		if (t < o || a + t > n) break;
		i.push({
			type: E(e, a + 4),
			content: a + o,
			end: a + t
		}), a += t;
	}
	return i;
}
var O = 11;
function te(e) {
	let t = D(e, 0, e.length).find((e) => e.type === "meta");
	if (!t) return null;
	let n = D(e, t.content + 4, t.end).find((e) => e.type === "iprp"), r = n && D(e, n.content, n.end).find((e) => e.type === "ipco"), i = r && D(e, r.content, r.end).find((t) => t.type === "colr" && t.end - t.content >= O && E(e, t.content) === "nclx");
	return i ? i.content + 4 : null;
}
function ne(e, t = 9, n = 16) {
	let r = te(e);
	if (r === null) return !1;
	let i = new DataView(e.buffer, e.byteOffset, e.byteLength);
	return i.setUint16(r, t), i.setUint16(r + 2, n), !0;
}
//#endregion
//#region src/avif-exif.ts
var re = (e, t) => String.fromCharCode(e[t], e[t + 1], e[t + 2], e[t + 3]);
function k(e, t, n) {
	let r = new DataView(e.buffer, e.byteOffset, e.byteLength), i = [], a = t;
	for (; a < n;) {
		if (a + 8 > n) return null;
		let t = r.getUint32(a);
		if (t < 8 || a + t > n) return null;
		i.push({
			type: re(e, a + 4),
			start: a,
			content: a + 8,
			end: a + t
		}), a += t;
	}
	return i;
}
function A(e, t, n) {
	let r = 0;
	for (let i = 0; i < n; i++) r = r * 256 + e[t + i];
	return r;
}
function j(e, t) {
	let n = [];
	for (let r = t - 1; r >= 0; r--) n.push(Math.floor(e / 2 ** (8 * r)) % 256);
	return n;
}
var M = (e, t) => e < 2 ** (8 * t);
function N(e, ...t) {
	let n = 8 + t.reduce((e, t) => e + t.length, 0), r = new Uint8Array(n);
	r.set(j(n, 4)), r.set(new TextEncoder().encode(e), 4);
	let i = 8;
	for (let e of t) r.set(e, i), i += e.length;
	return r;
}
var ie = [
	0,
	4,
	8
];
function ae(e, t) {
	let n = t.content, r = (e) => n + e <= t.end;
	if (!r(8)) return null;
	let i = e[n];
	if (i > 2) return null;
	n += 4;
	let a = e[n] >> 4, o = e[n] & 15, s = e[n + 1] >> 4, c = i === 0 ? 0 : e[n + 1] & 15;
	if (n += 2, ![
		a,
		o,
		s,
		c
	].every((e) => ie.includes(e))) return null;
	let l = i === 2, u = A(e, n, l ? 4 : 2);
	n += l ? 4 : 2;
	let d = [];
	for (let t = 0; t < u; t++) {
		if (!r(l ? 4 : 2)) return null;
		let t = A(e, n, l ? 4 : 2);
		n += l ? 4 : 2;
		let u = 0;
		if (i > 0) {
			if (!r(2)) return null;
			u = A(e, n, 2) & 15, n += 2;
		}
		if (!r(4 + s)) return null;
		let f = A(e, n, 2), p = A(e, n + 2, s), m = A(e, n + 2 + s, 2);
		n += 4 + s;
		let h = [];
		for (let t = 0; t < m; t++) {
			if (!r(c + a + o)) return null;
			h.push({
				index: A(e, n, c),
				offset: A(e, n + c, a),
				length: A(e, n + c + a, o)
			}), n += c + a + o;
		}
		d.push({
			id: t,
			method: u,
			dataReference: f,
			base: p,
			extents: h
		});
	}
	return n === t.end ? {
		version: i,
		offsetSize: a,
		lengthSize: o,
		baseOffsetSize: s,
		indexSize: c,
		entries: d
	} : null;
}
function oe(e) {
	let t = e.version === 2, n = [];
	for (let r of e.entries) {
		n.push(...j(r.id, t ? 4 : 2)), e.version > 0 && n.push(...j(r.method, 2)), n.push(...j(r.dataReference, 2), ...j(r.base, e.baseOffsetSize), ...j(r.extents.length, 2));
		for (let t of r.extents) n.push(...j(t.index, e.indexSize), ...j(t.offset, e.offsetSize), ...j(t.length, e.lengthSize));
	}
	return N("iloc", [
		e.version,
		0,
		0,
		0,
		e.offsetSize << 4 | e.lengthSize,
		e.baseOffsetSize << 4 | e.indexSize
	], j(e.entries.length, t ? 4 : 2), n);
}
function se(e) {
	let t = k(e, 0, e.length)?.find((e) => e.type === "meta");
	if (!t || t.end - t.content < 4 || e[t.content] !== 0) return null;
	let n = k(e, t.content + 4, t.end);
	return n && {
		box: t,
		children: n
	};
}
function ce(e, t) {
	let n = e[t.content] === 1;
	return t.end - t.content >= (n ? 8 : 6) ? A(e, t.content + 4, n ? 4 : 2) : null;
}
function le(e, t) {
	let n = e[t.content];
	if (n > 1) return null;
	let r = n === 0 ? 2 : 4, i = t.content + 4, a = k(e, i + r, t.end);
	if (!a || A(e, i, r) !== a.length) return null;
	let o = [];
	for (let t of a) {
		if (t.type !== "infe") return null;
		let n = e[t.content];
		if (n < 2) o.push({
			id: A(e, t.content + 4, 2),
			type: null
		});
		else {
			let r = n === 3 ? 4 : 2;
			if (t.end - t.content < 4 + r + 2 + 4) return null;
			o.push({
				id: A(e, t.content + 4, r),
				type: re(e, t.content + 4 + r + 2)
			});
		}
	}
	return {
		version: n,
		countAt: i,
		countSize: r,
		items: o
	};
}
function ue(e, t) {
	let n = e[t.content];
	if (n > 1) return null;
	let r = n === 0 ? 2 : 4, i = k(e, t.content + 4, t.end);
	if (!i) return null;
	let a = /* @__PURE__ */ new Map();
	for (let t of i) {
		if (t.type !== "cdsc") continue;
		if (t.end - t.content < r + 2) return null;
		let n = A(e, t.content + r, 2);
		if (t.end - t.content < r + 2 + n * r) return null;
		let i = [];
		for (let a = 0; a < n; a++) i.push(A(e, t.content + r + 2 + a * r, r));
		a.set(A(e, t.content, r), i);
	}
	return a;
}
function de(e) {
	let t = /* @__PURE__ */ new Map(), n = se(e)?.children.find((e) => e.type === "iloc"), r = n && ae(e, n);
	if (!r) return t;
	for (let n of r.entries) {
		if (n.method !== 0 || n.dataReference !== 0) continue;
		let r = n.extents.map((e) => ({
			start: n.base + e.offset,
			length: e.length
		}));
		if (r.some((t) => t.start + t.length > e.length)) continue;
		if (r.length === 1) {
			t.set(n.id, e.subarray(r[0].start, r[0].start + r[0].length));
			continue;
		}
		let i = new Uint8Array(r.reduce((e, t) => e + t.length, 0)), a = 0;
		for (let t of r) i.set(e.subarray(t.start, t.start + t.length), a), a += t.length;
		t.set(n.id, i);
	}
	return t;
}
function fe(e) {
	let t = se(e), n = t?.children.find((e) => e.type === "iinf"), r = t?.children.find((e) => e.type === "iref"), i = (n && le(e, n))?.items.find((e) => e.type === "Exif"), a = r && ue(e, r), o = i && de(e).get(i.id), s = i && a?.get(i.id)?.[0];
	if (!o || o.length < 4 || s === void 0) return null;
	let c = A(o, 0, 4);
	return 4 + c <= o.length ? {
		tiff: o.subarray(4 + c),
		describes: s
	} : null;
}
var pe = (e, t) => e.length === t.length && e.every((e, n) => e === t[n]);
function me(e, t) {
	if (t.length === 0) return null;
	let n = se(e);
	if (!n) return null;
	let r = (e) => n.children.find((t) => t.type === e), [i, a, o, s] = [
		r("pitm"),
		r("iloc"),
		r("iinf"),
		r("iref")
	];
	if (!i || !a || !o) return null;
	let c = ce(e, i), l = ae(e, a), u = le(e, o);
	if (s && e[s.content] > 1 || c === null || !l || !u) return null;
	let d = Math.max(...u.items.map((e) => e.id), ...l.entries.map((e) => e.id)) + 1;
	if (d >= 2 ** 16 || l.offsetSize === 0 || l.lengthSize === 0) return null;
	let f = N("infe", [
		2,
		0,
		0,
		0
	], j(d, 2), [0, 0], Array.from(new TextEncoder().encode("Exif\0"))), p = N("iinf", [
		u.version,
		0,
		0,
		0
	], j(u.items.length + 1, u.countSize), e.subarray(u.countAt + u.countSize, o.end), f), m = s ? e[s.content] === 1 : c >= 2 ** 16, h = N("cdsc", j(d, m ? 4 : 2), j(1, 2), j(c, m ? 4 : 2)), g = s ? N("iref", Array.from(e.subarray(s.content, s.end)), h) : N("iref", [
		+!!m,
		0,
		0,
		0
	], h), _ = l.version === 2 ? 4 : 2, v = l.version > 0 ? 2 : 0, y = l.indexSize + l.offsetSize + l.lengthSize, b = _ + v + 2 + l.baseOffsetSize + 2 + y, x = (e) => e.end - e.start, S = p.length - x(o) + g.length - (s ? x(s) : 0) + b, C = new Uint8Array(4 + t.length);
	C.set(t, 4);
	let ee = e.length + S + 8, w = {
		...l,
		entries: l.entries.map((e) => e.method !== 0 || e.dataReference !== 0 || !e.extents.some((t) => e.base + t.offset >= n.box.end) ? e : l.baseOffsetSize > 0 ? {
			...e,
			base: e.base + S
		} : {
			...e,
			extents: e.extents.map((e) => ({
				...e,
				offset: e.offset + S
			}))
		})
	};
	if (w.entries.push({
		id: d,
		method: 0,
		dataReference: 0,
		base: 0,
		extents: [{
			index: 0,
			offset: ee,
			length: C.length
		}]
	}), !w.entries.every((e) => M(e.base, l.baseOffsetSize) && e.extents.every((e) => M(e.offset, l.offsetSize) && M(e.length, l.lengthSize)))) return null;
	let T = [];
	for (let t of n.children) t === a ? T.push(oe(w)) : t === o ? T.push(p) : t === s ? T.push(g) : T.push(e.subarray(t.start, t.end)), t === o && !s && T.push(g);
	let E = N("meta", Array.from(e.subarray(n.box.content, n.box.content + 4)), ...T);
	if (E.length - x(n.box) !== S) return null;
	let D = N("mdat", C), O = new Uint8Array(e.length + S + D.length);
	return O.set(e.subarray(0, n.box.start)), O.set(E, n.box.start), O.set(e.subarray(n.box.end), n.box.start + E.length), O.set(D, e.length + S), he(e, O, t, c) ? O : null;
}
function he(e, t, n, r) {
	if (!k(t, 0, t.length)) return !1;
	let i = de(t);
	for (let [t, n] of de(e)) {
		let e = i.get(t);
		if (!e || !pe(e, n)) return !1;
	}
	let a = fe(t);
	return a !== null && a.describes === r && pe(a.tiff, n);
}
//#endregion
//#region src/jpeg.ts
function ge(e) {
	if (e.length < 4 || e[0] !== 255 || e[1] !== 216) throw Error("[hdr-editing] not a JPEG");
	let t = [], n = 2;
	for (; n + 4 <= e.length;) {
		if (e[n] !== 255) throw Error(`[hdr-editing] no JPEG marker at byte ${n}`);
		let r = n;
		for (; e[r + 1] === 255;) r++;
		let i = e[r + 1];
		if (i === 218) return {
			segments: t,
			scan: r
		};
		if (i === 1 || i >= 208 && i <= 215) {
			t.push({
				marker: i,
				start: r,
				end: r + 2
			}), n = r + 2;
			continue;
		}
		let a = r + 2 + (e[r + 2] << 8 | e[r + 3]);
		if (a > e.length) throw Error("[hdr-editing] JPEG segment runs past the end");
		t.push({
			marker: i,
			start: r,
			end: a
		}), n = a;
	}
	throw Error("[hdr-editing] JPEG has no scan");
}
var _e = (e) => e >= 192 && e <= 207 && e !== 196 && e !== 200 && e !== 204;
function ve(e) {
	try {
		let { segments: t } = ge(e), n = t.find((e) => _e(e.marker));
		if (!n) return null;
		let r = n.start + 4;
		return {
			height: e[r + 1] << 8 | e[r + 2],
			width: e[r + 3] << 8 | e[r + 4]
		};
	} catch {
		return null;
	}
}
function ye(e, t) {
	return e.subarray(t.start + 4, t.end);
}
function P(e, t) {
	let n = t.length + 2;
	if (n > 65535) throw Error("[hdr-editing] JPEG segment too long");
	let r = new Uint8Array(n + 2);
	return r.set([
		255,
		e,
		n >> 8,
		n & 255
	]), r.set(t, 4), r;
}
function F(e) {
	let t = new Uint8Array(e.reduce((e, t) => e + t.length, 0)), n = 0;
	for (let r of e) t.set(r, n), n += r.length;
	return t;
}
var I = (e) => new TextEncoder().encode(e);
function L(e, t) {
	if (e.length < t.length) return !1;
	for (let n = 0; n < t.length; n++) if (e[n] !== t[n]) return !1;
	return !0;
}
//#endregion
//#region src/exif.ts
var R = Uint8Array.of(69, 120, 105, 102, 0, 0), be = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), z = (e, t) => String.fromCharCode(e[t], e[t + 1], e[t + 2], e[t + 3]);
function xe(e) {
	if (e.length < 8) return null;
	let t = e[0] === 73 && e[1] === 73 && e[2] === 42 && e[3] === 0, n = e[0] === 77 && e[1] === 77 && e[2] === 0 && e[3] === 42;
	return t || n ? e : null;
}
function Se(e) {
	for (let t of ge(e).segments) {
		if (t.marker !== 225) continue;
		let n = ye(e, t);
		if (L(n, R)) return n.subarray(R.length);
	}
	return null;
}
function Ce(e) {
	let t = new DataView(e.buffer, e.byteOffset, e.byteLength), n = be.length;
	for (; n + 12 <= e.length;) {
		let r = t.getUint32(n), i = n + 8;
		if (i + r + 4 > e.length) return null;
		if (z(e, n + 4) === "eXIf") return e.subarray(i, i + r);
		n = i + r + 4;
	}
	return null;
}
function we(e) {
	let t = new DataView(e.buffer, e.byteOffset, e.byteLength), n = 12;
	for (; n + 8 <= e.length;) {
		let r = t.getUint32(n + 4, !0), i = n + 8;
		if (i + r > e.length) return null;
		if (z(e, n) === "EXIF") {
			let t = e.subarray(i, i + r);
			return L(t, R) ? t.subarray(R.length) : t;
		}
		n = i + r + r % 2;
	}
	return null;
}
function Te(e) {
	return e[0] === 255 && e[1] === 216 ? Se(e) : L(e, be) ? Ce(e) : e.length >= 12 && z(e, 0) === "RIFF" && z(e, 8) === "WEBP" ? we(e) : null;
}
function Ee(e) {
	try {
		let t = Te(e);
		return t && xe(t);
	} catch {
		return null;
	}
}
//#endregion
//#region src/frame.ts
var B = Float64Array.from({ length: 256 }, (e, t) => r(t / 255)), V = null;
function H(e, t) {
	let { width: n, height: r } = e;
	if (n < 2 || r < 2) return null;
	let i = Math.min(1, t / Math.max(n, r)), a = Math.max(1, Math.round(n * i)), o = Math.max(1, Math.round(r * i));
	V ||= new OffscreenCanvas(a, o), V.width !== a && (V.width = a), V.height !== o && (V.height = o);
	let s = V.getContext("2d", { willReadFrequently: !0 });
	return s ? (s.globalCompositeOperation = "copy", s.imageSmoothingQuality = "high", s.drawImage(e, 0, 0, a, o), {
		data: s.getImageData(0, 0, a, o).data,
		width: a,
		height: o
	}) : null;
}
function De(e, t, n) {
	if (e.width === t && e.height === n) return e;
	let r = new Uint8ClampedArray(t * n * 4), i = e.width / t, a = e.height / n, o = (t, n, r) => e.data[(n * e.width + t) * 4 + r];
	for (let s = 0; s < n; s++) {
		let n = Math.min(Math.max((s + .5) * a - .5, 0), e.height - 1), c = Math.floor(n), l = Math.min(c + 1, e.height - 1), u = n - c;
		for (let n = 0; n < t; n++) {
			let a = Math.min(Math.max((n + .5) * i - .5, 0), e.width - 1), d = Math.floor(a), f = Math.min(d + 1, e.width - 1), p = a - d;
			for (let e = 0; e < 4; e++) {
				let i = o(d, c, e) * (1 - p) + o(f, c, e) * p, a = o(d, l, e) * (1 - p) + o(f, l, e) * p;
				r[(s * t + n) * 4 + e] = i * (1 - u) + a * u;
			}
		}
	}
	return {
		data: r,
		width: t,
		height: n
	};
}
//#endregion
//#region src/jpeg-encode.ts
var Oe = Int32Array.from([
	0,
	1,
	8,
	16,
	9,
	2,
	3,
	10,
	17,
	24,
	32,
	25,
	18,
	11,
	4,
	5,
	12,
	19,
	26,
	33,
	40,
	48,
	41,
	34,
	27,
	20,
	13,
	6,
	7,
	14,
	21,
	28,
	35,
	42,
	49,
	56,
	57,
	50,
	43,
	36,
	29,
	22,
	15,
	23,
	30,
	37,
	44,
	51,
	58,
	59,
	52,
	45,
	38,
	31,
	39,
	46,
	53,
	60,
	61,
	54,
	47,
	55,
	62,
	63
]), ke = [
	16,
	11,
	10,
	16,
	24,
	40,
	51,
	61,
	12,
	12,
	14,
	19,
	26,
	58,
	60,
	55,
	14,
	13,
	16,
	24,
	40,
	57,
	69,
	56,
	14,
	17,
	22,
	29,
	51,
	87,
	80,
	62,
	18,
	22,
	37,
	56,
	68,
	109,
	103,
	77,
	24,
	35,
	55,
	64,
	81,
	104,
	113,
	92,
	49,
	64,
	78,
	87,
	103,
	121,
	120,
	101,
	72,
	92,
	95,
	98,
	112,
	100,
	103,
	99
], Ae = [
	0,
	1,
	5,
	1,
	1,
	1,
	1,
	1,
	1,
	0,
	0,
	0,
	0,
	0,
	0,
	0
], je = [
	0,
	1,
	2,
	3,
	4,
	5,
	6,
	7,
	8,
	9,
	10,
	11
], Me = [
	0,
	2,
	1,
	3,
	3,
	2,
	4,
	3,
	5,
	5,
	4,
	4,
	0,
	0,
	1,
	125
], Ne = [
	1,
	2,
	3,
	0,
	4,
	17,
	5,
	18,
	33,
	49,
	65,
	6,
	19,
	81,
	97,
	7,
	34,
	113,
	20,
	50,
	129,
	145,
	161,
	8,
	35,
	66,
	177,
	193,
	21,
	82,
	209,
	240,
	36,
	51,
	98,
	114,
	130,
	9,
	10,
	22,
	23,
	24,
	25,
	26,
	37,
	38,
	39,
	40,
	41,
	42,
	52,
	53,
	54,
	55,
	56,
	57,
	58,
	67,
	68,
	69,
	70,
	71,
	72,
	73,
	74,
	83,
	84,
	85,
	86,
	87,
	88,
	89,
	90,
	99,
	100,
	101,
	102,
	103,
	104,
	105,
	106,
	115,
	116,
	117,
	118,
	119,
	120,
	121,
	122,
	131,
	132,
	133,
	134,
	135,
	136,
	137,
	138,
	146,
	147,
	148,
	149,
	150,
	151,
	152,
	153,
	154,
	162,
	163,
	164,
	165,
	166,
	167,
	168,
	169,
	170,
	178,
	179,
	180,
	181,
	182,
	183,
	184,
	185,
	186,
	194,
	195,
	196,
	197,
	198,
	199,
	200,
	201,
	202,
	210,
	211,
	212,
	213,
	214,
	215,
	216,
	217,
	218,
	225,
	226,
	227,
	228,
	229,
	230,
	231,
	232,
	233,
	234,
	241,
	242,
	243,
	244,
	245,
	246,
	247,
	248,
	249,
	250
], Pe = /* @__PURE__ */ new Float64Array(64);
for (let e = 0; e < 8; e++) for (let t = 0; t < 8; t++) Pe[e * 8 + t] = (e === 0 ? Math.SQRT1_2 : 1) * Math.cos((2 * t + 1) * e * Math.PI / 16) / 2;
function Fe(e) {
	let t = Math.min(100, Math.max(1, Math.round(e))), n = t < 50 ? Math.floor(5e3 / t) : 200 - 2 * t;
	return Uint8Array.from(ke, (e) => Math.min(255, Math.max(1, Math.floor((e * n + 50) / 100))));
}
function Ie(e, t) {
	let n = /* @__PURE__ */ new Uint16Array(256), r = /* @__PURE__ */ new Uint8Array(256), i = 0, a = 0;
	for (let o = 1; o <= 16; o++) {
		for (let s = 0; s < e[o - 1]; s++) n[t[a]] = i, r[t[a]] = o, i++, a++;
		i <<= 1;
	}
	return {
		code: n,
		size: r
	};
}
var Le = class {
	constructor() {
		this.buf = /* @__PURE__ */ new Uint8Array(65536), this.len = 0, this.acc = 0, this.bits = 0;
	}
	push(e) {
		if (this.len === this.buf.length) {
			let e = new Uint8Array(this.buf.length * 2);
			e.set(this.buf), this.buf = e;
		}
		this.buf[this.len++] = e;
	}
	write(e, t) {
		for (let n = t - 1; n >= 0; n--) this.acc = this.acc << 1 | e >> n & 1, ++this.bits === 8 && (this.push(this.acc), this.acc === 255 && this.push(0), this.acc = 0, this.bits = 0);
	}
	bytes() {
		if (this.bits > 0) {
			let e = 8 - this.bits;
			this.write((1 << e) - 1, e);
		}
		return this.buf.subarray(0, this.len);
	}
}, Re = (e) => e === 0 ? 0 : 32 - Math.clz32(Math.abs(e)), ze = (e, t) => e < 0 ? e + (1 << t) - 1 : e;
function Be(e, t, n) {
	for (let n = 0; n < 8; n++) for (let r = 0; r < 8; r++) {
		let i = 0;
		for (let t = 0; t < 8; t++) i += e[n * 8 + t] * Pe[r * 8 + t];
		t[n * 8 + r] = i;
	}
	for (let e = 0; e < 8; e++) for (let r = 0; r < 8; r++) {
		let i = 0;
		for (let n = 0; n < 8; n++) i += t[n * 8 + r] * Pe[e * 8 + n];
		n[e * 8 + r] = i;
	}
}
function Ve(e, t, n, r = 90) {
	let i = Fe(r), a = Ie(Ae, je), o = Ie(Me, Ne), s = new Le(), c = /* @__PURE__ */ new Float64Array(64), l = /* @__PURE__ */ new Float64Array(64), u = /* @__PURE__ */ new Float64Array(64), d = /* @__PURE__ */ new Int32Array(64), f = 0;
	for (let r = 0; r < n; r += 8) for (let p = 0; p < t; p += 8) {
		for (let i = 0; i < 8; i++) {
			let a = Math.min(r + i, n - 1) * t;
			for (let n = 0; n < 8; n++) c[i * 8 + n] = e[a + Math.min(p + n, t - 1)] - 128;
		}
		Be(c, l, u);
		for (let e = 0; e < 64; e++) {
			let t = Oe[e], n = Math.round(u[t] / i[t]);
			d[e] = e === 0 ? n : Math.max(-1023, Math.min(1023, n));
		}
		let m = d[0] - f;
		f = d[0];
		let h = Re(m);
		s.write(a.code[h], a.size[h]), h > 0 && s.write(ze(m, h), h);
		let g = 0;
		for (let e = 1; e < 64; e++) {
			let t = d[e];
			if (t === 0) {
				g++;
				continue;
			}
			for (; g > 15;) s.write(o.code[240], o.size[240]), g -= 16;
			let n = Re(t), r = g << 4 | n;
			s.write(o.code[r], o.size[r]), s.write(ze(t, n), n), g = 0;
		}
		g > 0 && s.write(o.code[0], o.size[0]);
	}
	let p = /* @__PURE__ */ new Uint8Array(65);
	for (let e = 0; e < 64; e++) p[1 + e] = i[Oe[e]];
	return F([
		Uint8Array.of(255, 216),
		P(224, Uint8Array.of(74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0)),
		P(219, p),
		P(192, Uint8Array.of(8, n >> 8, n & 255, t >> 8, t & 255, 1, 1, 17, 0)),
		P(196, Uint8Array.from([
			0,
			...Ae,
			...je,
			16,
			...Me,
			...Ne
		])),
		P(218, Uint8Array.of(1, 1, 0, 0, 63, 0)),
		s.bytes(),
		Uint8Array.of(255, 217)
	]);
}
//#endregion
//#region src/notice.ts
function He(e) {
	let [t] = e;
	return e.length === 1 ? `${t.label} ${t.problem}` : `${e.length} photos didn't export as asked. First: ${t.label} ${t.problem}`;
}
var Ue = 3e5;
function We(e, t = Date.now) {
	let n = [], r = 0;
	return {
		add(i, a) {
			let o = t();
			o - r > Ue && (n = []), r = o, n.push({
				label: i,
				problem: a
			}), e(He(n));
		},
		clear() {
			n = [];
		}
	};
}
var U = null, W = null;
function Ge() {
	if (U && document.body.contains(U)) return U;
	let e = document.createElement("div");
	e.setAttribute("data-hdr-editing-notice", ""), e.setAttribute("role", "status"), Object.assign(e.style, {
		position: "fixed",
		right: "16px",
		bottom: "16px",
		zIndex: "2147483000",
		maxWidth: "340px",
		padding: "10px 26px 10px 12px",
		borderRadius: "6px",
		border: "1px solid var(--color-border)",
		background: "var(--color-surface-1)",
		color: "var(--color-text-primary)",
		font: "11px/1.45 system-ui, sans-serif",
		boxShadow: "0 4px 16px rgba(0,0,0,0.35)"
	});
	let t = document.createElement("button");
	return t.textContent = "✕", t.title = "Dismiss", t.setAttribute("aria-label", "Dismiss"), Object.assign(t.style, {
		position: "absolute",
		top: "4px",
		right: "6px",
		border: "none",
		background: "none",
		color: "var(--color-text-muted)",
		font: "10px/1 system-ui, sans-serif",
		cursor: "pointer",
		padding: "2px"
	}), t.addEventListener("click", () => {
		Je.clear(), e.style.display = "none";
	}), W = document.createElement("div"), W.style.userSelect = "text", e.append(t, W), document.body.appendChild(e), U = e, e;
}
function Ke(e) {
	let t = Ge();
	t.style.display = "block", W && (W.textContent = e);
}
function qe() {
	Je.clear(), U?.remove(), U = null, W = null;
}
var Je = We(Ke);
//#endregion
//#region src/pq.ts
function Ye(e, t) {
	if (t.width !== e.width || t.height !== e.height) throw Error(`[hdr-editing] the gain map is ${t.width}x${t.height}, the image ${e.width}x${e.height}`);
}
//#endregion
//#region src/runtime.ts
var Xe = null;
function Ze(e) {
	Xe = e;
}
function G() {
	if (!Xe) throw Error("[hdr-editing] api() called before activate()");
	return Xe;
}
function K(e, t, ...n) {
	return G().react.createElement(e, t, ...n);
}
//#endregion
//#region src/ultrahdr.ts
var Qe = I("http://ns.adobe.com/xap/1.0/\0"), $e = I("urn:iso:std:iso:ts:21496:-1\0"), et = I("MPF\0"), tt = I("Exif\0\0"), nt = I("ICC_PROFILE\0"), rt = 224, it = 225, q = 226, at = 237, ot = 90, J = (e) => String(Number(e.toPrecision(6)));
function st(e) {
	return [
		"<x:xmpmeta",
		"  xmlns:x=\"adobe:ns:meta/\"",
		"  x:xmptk=\"Adobe XMP Core 5.1.2\">",
		"  <rdf:RDF",
		"    xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">",
		"    <rdf:Description",
		"      xmlns:Container=\"http://ns.google.com/photos/1.0/container/\"",
		"      xmlns:Item=\"http://ns.google.com/photos/1.0/container/item/\"",
		"      xmlns:hdrgm=\"http://ns.adobe.com/hdr-gain-map/1.0/\"",
		"      hdrgm:Version=\"1.0\">",
		"      <Container:Directory>",
		"        <rdf:Seq>",
		"          <rdf:li",
		"            rdf:parseType=\"Resource\">",
		"            <Container:Item",
		"              Item:Semantic=\"Primary\"",
		"              Item:Mime=\"image/jpeg\"/>",
		"          </rdf:li>",
		"          <rdf:li",
		"            rdf:parseType=\"Resource\">",
		"            <Container:Item",
		"              Item:Semantic=\"GainMap\"",
		"              Item:Mime=\"image/jpeg\"",
		`              Item:Length="${e}"/>`,
		"          </rdf:li>",
		"        </rdf:Seq>",
		"      </Container:Directory>",
		"    </rdf:Description>",
		"  </rdf:RDF>",
		"</x:xmpmeta>",
		""
	].join("\n");
}
function ct(t) {
	return [
		"<x:xmpmeta",
		"  xmlns:x=\"adobe:ns:meta/\"",
		"  x:xmptk=\"Adobe XMP Core 5.1.2\">",
		"  <rdf:RDF",
		"    xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">",
		"    <rdf:Description",
		"      rdf:about=\"\"",
		"      xmlns:hdrgm=\"http://ns.adobe.com/hdr-gain-map/1.0/\"",
		"      hdrgm:Version=\"1.0\"",
		"      hdrgm:GainMapMin=\"0\"",
		`      hdrgm:GainMapMax="${J(t)}"`,
		"      hdrgm:Gamma=\"1\"",
		`      hdrgm:OffsetSDR="${J(e)}"`,
		`      hdrgm:OffsetHDR="${J(e)}"`,
		"      hdrgm:HDRCapacityMin=\"0\"",
		`      hdrgm:HDRCapacityMax="${J(t)}"`,
		"      hdrgm:BaseRenditionIsHDR=\"False\"/>",
		"  </rdf:RDF>",
		"</x:xmpmeta>",
		""
	].join("\n");
}
var lt = (e, t) => t === 0 ? e : lt(t, e % t);
function ut(e) {
	let t = Math.round(e * 10), n = lt(t, 10);
	return [t / n, 10 / n];
}
function dt() {
	return P(q, new Uint8Array([
		...$e,
		0,
		0,
		0,
		0
	]));
}
function ft(e) {
	let t = /* @__PURE__ */ new Uint8Array(61), n = new DataView(t.buffer), [r, i] = ut(e);
	return n.setUint16(0, 0), n.setUint16(2, 0), t[4] = 64, [
		[0, 1],
		[r, i],
		[0, 1],
		[r, i],
		[1, 1],
		[1, 64],
		[1, 64]
	].forEach(([e, t], r) => {
		n.setUint32(5 + r * 8, e >>> 0), n.setUint32(9 + r * 8, t);
	}), t;
}
function pt(e, t, n) {
	let r = /* @__PURE__ */ new Uint8Array(86), i = new DataView(r.buffer);
	return r.set(et, 0), r.set([
		77,
		77,
		0,
		42
	], 4), i.setUint32(8, 8), i.setUint16(12, 3), i.setUint16(14, 45056), i.setUint16(16, 7), i.setUint32(18, 4), r.set(I("0100"), 22), i.setUint16(26, 45057), i.setUint16(28, 4), i.setUint32(30, 1), i.setUint32(34, 2), i.setUint16(38, 45058), i.setUint16(40, 7), i.setUint32(42, 32), i.setUint32(46, 50), i.setUint32(50, 0), i.setUint32(54, 196608), i.setUint32(58, e), i.setUint32(62, 0), i.setUint32(70, 0), i.setUint32(74, t), i.setUint32(78, n), P(q, r);
}
function mt(e, t) {
	let n = ye(e, t);
	return t.marker === rt ? "jfif" : t.marker === it && L(n, tt) ? "exif" : t.marker === q && L(n, nt) ? "icc" : t.marker === at ? "keep" : t.marker >= 224 && t.marker <= 239 ? "drop" : "table";
}
function ht(e, t) {
	let n = t + 2 + (e[t + 2] << 8 | e[t + 3]);
	for (let t = n; t + 1 < e.length; t++) if (e[t] === 255 && e[t + 1] === 217) return t + 2;
	throw Error("[hdr-editing] JPEG has no end of image");
}
function gt(e, t, n) {
	if (!Number.isFinite(n)) throw Error(`[hdr-editing] headroom ${n} is not a number`);
	if (t.length < 2 || t[0] !== 255 || t[1] !== 216) throw Error("[hdr-editing] the gain map is not a JPEG");
	let r = a(n), i = F([
		Uint8Array.of(255, 216),
		P(it, new Uint8Array([...Qe, ...I(ct(r))])),
		P(q, new Uint8Array([...$e, ...ft(r)])),
		t.subarray(2)
	]), { segments: o, scan: s } = ge(e), c = (t) => o.filter((n) => mt(e, n) === t).map((t) => e.subarray(t.start, t.end)), l = F([
		Uint8Array.of(255, 216),
		...c("jfif"),
		...c("exif"),
		P(it, new Uint8Array([...Qe, ...I(st(i.length))])),
		...c("icc"),
		dt(),
		...c("keep"),
		...c("table")
	]), u = e.subarray(s, ht(e, s)), d = l.length + ot + u.length;
	return F([
		l,
		pt(d, i.length, d - (l.length + 8)),
		u,
		i
	]);
}
var _t = 80, vt = [{
	key: "output",
	label: "HDR output",
	hint: "For photos with HDR on. Ultra HDR needs the JPEG format. HDR AVIF replaces a JPEG, PNG or WebP file with one built from it. It is always Rec.2020 PQ, so the colour space setting doesn't apply, and it carries the Exif metadata only. A photo that can't get HDR is exported as it is, and listed in a notice.",
	type: "select",
	default: "off",
	options: [
		{
			value: "off",
			label: "Off"
		},
		{
			value: "ultrahdr",
			label: "Ultra HDR JPEG"
		},
		{
			value: "avif",
			label: "HDR AVIF"
		}
	]
}, {
	key: "avifQuality",
	label: "HDR AVIF quality",
	hint: "HDR AVIF only.",
	type: "number",
	default: _t,
	min: 1,
	max: 100,
	step: 1
}], yt = (e, t) => new Blob([new Uint8Array(e)], { type: t });
function bt(e) {
	let t = new Uint8Array(e.width * e.height);
	for (let n = 0; n < t.length; n++) t[n] = e.data[n * 4];
	return t;
}
function xt(e, t) {
	let n = typeof e == "number" ? Math.trunc(e) : NaN;
	return Number.isNaN(n) ? t - 1 : Math.min(Math.max(n, 0), t - 1);
}
function St(e) {
	let t = typeof e == "string" && e.trim() !== "" ? Number(e) : e;
	return typeof t != "number" || !Number.isFinite(t) ? _t : Math.min(100, Math.max(1, Math.round(t)));
}
async function Ct(e, t, n) {
	let r = await n.renderGainMap(e, t), i = r && await n.decode(r);
	if (!i) throw Error("the gain map didn't render");
	return i;
}
function wt(e, t, n, r) {
	return r.warn(`[hdr-editing] HDR export of ${t.id} failed, exported without HDR: ${n}`), r.notify(t, `was exported without HDR: ${n}`), e;
}
function Tt(e, t) {
	return Math.abs(e.width * t.height - e.height * t.width) <= t.width + t.height;
}
async function Et(e, t, n, r, i) {
	if (e.type !== "image/jpeg") return wt(e, t, "Ultra HDR needs the JPEG export format", i);
	let a = new Uint8Array(await e.arrayBuffer()), o = ve(a);
	if (!o) throw Error("the exported JPEG has no size");
	let s = await Ct(t, r, i);
	if (!Tt(s, o)) throw Error(`the gain map came out ${s.width}×${s.height}, not the shape of the ${o.width}×${o.height} image`);
	return yt(gt(a, Ve(bt(s), s.width, s.height, 90), n.headroom), "image/jpeg");
}
async function Dt(e, t, n, r, i, a) {
	if (e.type !== "image/jpeg" && e.type !== "image/png" && e.type !== "image/webp") return wt(e, t, "HDR AVIF needs the JPEG, PNG or WebP export format", a);
	let o = await Ot(e, t, i, a), s = await Ct(t, i.longEdge, a);
	if (!Tt(s, o)) throw Error(`the gain map came out ${s.width}×${s.height}, not the shape of the ${o.width}×${o.height} image`);
	let c = De(s, o.width, o.height);
	Ye(o, c);
	let l = await a.encodeAvif(o, c, n.headroom, r);
	if (!ne(l)) throw Error("the AVIF has no colour box to mark as PQ");
	return yt(await kt(l, e, t, a), "image/avif");
}
async function Ot(e, t, n, r) {
	if (!n.settings) {
		let t = await r.decodeFile(e);
		if (!t) throw Error("the exported file didn't decode");
		return t;
	}
	let i = await r.renderBase(t, n.settings), a = i && await r.decode(i);
	if (!a) throw Error("the base image didn't render");
	return a;
}
async function kt(e, t, n, r) {
	let i = Ee(new Uint8Array(await t.arrayBuffer()));
	return i ? me(e, i) || (r.warn(`[hdr-editing] the Exif metadata of ${n.id} couldn't be added to its HDR AVIF.`), r.notify(n, "was exported without its metadata: the HDR AVIF couldn't take it"), e) : e;
}
async function At(e, t, n, r, i) {
	let a = n.output;
	if (a !== "ultrahdr" && a !== "avif") return e;
	try {
		let o = await i.edit(t.id);
		if (!o || !x(o.params)) return e;
		let s = _(o.bag);
		return s.on ? a === "ultrahdr" ? await Et(e, t, s, r.longEdge, i) : await Dt(e, t, s, St(n.avifQuality), r, i) : e;
	} catch (n) {
		return wt(e, t, n instanceof Error ? n.message : String(n), i);
	}
}
function jt() {
	let e = G();
	return {
		edit: async (t) => {
			let n = await e.catalog.getEditState(t);
			if (!n || n.stack.length === 0) return null;
			let r = n.stack[xt(n.currentIndex, n.stack.length)];
			return {
				bag: r.paramBag ?? {},
				params: r.params
			};
		},
		renderBase: async (t, n) => {
			let [r] = await e.export.renderPhotos([t], {
				...n,
				format: "image/png",
				pngBitDepth: 8,
				colorSpace: "srgb",
				includeMetadata: !1,
				includeLocation: !1
			});
			return r?.blob ?? null;
		},
		renderGainMap: async (t, n) => {
			let [r] = await e.export.renderPhotos([t], {
				format: "image/png",
				longEdge: n,
				colorSpace: "srgb",
				sharpenAmount: 0,
				includeMetadata: !1
			}, void 0, { paramBag: { ...m } });
			return r?.blob ?? null;
		},
		decode: async (e) => {
			let t = await createImageBitmap(e, {
				colorSpaceConversion: "none",
				premultiplyAlpha: "none"
			});
			try {
				return H(t, Infinity);
			} finally {
				t.close();
			}
		},
		decodeFile: async (e) => {
			let t = await createImageBitmap(e, {
				colorSpaceConversion: "default",
				premultiplyAlpha: "none"
			});
			try {
				return H(t, Infinity);
			} finally {
				t.close();
			}
		},
		encodeAvif: (e, t, n, r) => T.encode(e, t, n, r),
		warn: (e) => console.warn(e),
		notify: (e, t) => {
			try {
				Je.add(e.filename ?? e.id, t);
			} catch (e) {
				console.warn(`[hdr-editing] couldn't show the export notice: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	};
}
//#endregion
//#region src/frames.ts
function Mt(e, t) {
	let n = !1, r = null, i = !1, a = (t) => {
		try {
			return e.capture(t);
		} catch (e) {
			return Promise.reject(e);
		}
	}, o = async (t) => {
		let n = e.basis(), [r, i] = await Promise.allSettled([a(), a({ ...m })]), o = r.status === "fulfilled" ? r.value : null, s = i.status === "fulfilled" ? i.value : null;
		return o && s && o.width >= 2 && o.width === s.width && o.height === s.height ? {
			...n,
			sdr: o,
			gain: s,
			nonce: t
		} : (o?.close(), s?.close(), null);
	}, s = async (e) => {
		n = !0;
		try {
			let n = await o(e);
			if (i) {
				n?.sdr.close(), n?.gain.close();
				return;
			}
			t(n);
		} catch (e) {
			console.warn("[hdr-editing] A frame pair could not be published.", e);
		} finally {
			if (n = !1, r !== null) {
				let e = r;
				r = null, s(e);
			}
		}
	};
	return {
		request(e) {
			if (!i) {
				if (n) {
					r = e;
					return;
				}
				s(e);
			}
		},
		stop() {
			i = !0, r = null;
		}
	};
}
//#endregion
//#region src/preview-wgsl.ts
var Nt = "\nstruct Params { headroom: f32, weight: f32, offset: f32, pad: f32 };\n@group(0) @binding(0) var sdrTex: texture_2d<f32>;\n@group(0) @binding(1) var gainTex: texture_2d<f32>;\n@group(0) @binding(2) var<uniform> params: Params;\n\nstruct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };\n\n@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {\n  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));\n  var out: VOut;\n  out.pos = vec4f(p[i], 0.0, 1.0);\n  out.uv = vec2f((p[i].x + 1.0) * 0.5, (1.0 - p[i].y) * 0.5);\n  return out;\n}\n\nfn decode(c: vec3f) -> vec3f {\n  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c < vec3f(0.04045));\n}\n\nfn encodeExtended(v: vec3f) -> vec3f {\n  let a = abs(v);\n  let e = select(1.055 * pow(a, vec3f(1.0 / 2.4)) - 0.055, a * 12.92, a < vec3f(0.0031308));\n  return sign(v) * e;\n}\n\nfn texel(t: texture_2d<f32>, uv: vec2f) -> vec4f {\n  let size = vec2f(textureDimensions(t));\n  return textureLoad(t, vec2i(clamp(uv * size, vec2f(0.0), size - 1.0)), 0);\n}\n\n@fragment fn fs(in: VOut) -> @location(0) vec4f {\n  let sdr = decode(texel(sdrTex, in.uv).rgb);\n  let r = texel(gainTex, in.uv).r;\n  let hdr = (sdr + params.offset) * exp2(r * params.headroom * params.weight) - params.offset;\n  return vec4f(encodeExtended(hdr), 1.0);\n}\n";
function Pt(e, t) {
	return Math.min(1, Math.max(0, e / a(t)));
}
//#endregion
//#region src/PreviewLayer.ts
async function Ft(e, t) {
	let n = await navigator.gpu?.requestAdapter();
	if (!n) return null;
	let r = await n.requestDevice(), i = !1;
	try {
		r.addEventListener("uncapturederror", (e) => t("the GPU reported an error", e.error)), r.lost.then((e) => {
			e.reason !== "destroyed" && t("the GPU device was lost", e.message);
		});
		let n = e.getContext("webgpu");
		if (!n) return null;
		let a = {
			device: r,
			format: "rgba16float",
			colorSpace: "srgb",
			alphaMode: "opaque",
			toneMapping: { mode: "extended" }
		};
		n.configure(a);
		let o = r.createShaderModule({ code: Nt }), s = r.createRenderPipeline({
			layout: "auto",
			vertex: {
				module: o,
				entryPoint: "vs"
			},
			fragment: {
				module: o,
				entryPoint: "fs",
				targets: [{ format: "rgba16float" }]
			},
			primitive: { topology: "triangle-list" }
		}), c = r.createBuffer({
			size: 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});
		return i = !0, {
			device: r,
			context: n,
			pipeline: s,
			uniforms: c
		};
	} finally {
		i || r.destroy();
	}
}
function It(t, n, r, i, o) {
	if (r.sdr.width === 0 || r.gain.width === 0) return;
	let { device: s, context: c, pipeline: l, uniforms: u } = t;
	n.width !== r.sdr.width && (n.width = r.sdr.width), n.height !== r.sdr.height && (n.height = r.sdr.height);
	let d = (e) => {
		let t = s.createTexture({
			size: [e.width, e.height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
		});
		return s.queue.copyExternalImageToTexture({ source: e }, { texture: t }, [e.width, e.height]), t;
	}, f = d(r.sdr), p = d(r.gain);
	s.queue.writeBuffer(u, 0, new Float32Array([
		a(i),
		o,
		e,
		0
	]));
	let m = s.createBindGroup({
		layout: l.getBindGroupLayout(0),
		entries: [
			{
				binding: 0,
				resource: f.createView()
			},
			{
				binding: 1,
				resource: p.createView()
			},
			{
				binding: 2,
				resource: { buffer: u }
			}
		]
	}), h = s.createCommandEncoder(), g = h.beginRenderPass({ colorAttachments: [{
		view: c.getCurrentTexture().createView(),
		loadOp: "clear",
		storeOp: "store",
		clearValue: {
			r: 0,
			g: 0,
			b: 0,
			a: 1
		}
	}] });
	g.setPipeline(l), g.setBindGroup(0, m), g.draw(3), g.end(), s.queue.submit([h.finish()]), f.destroy(), p.destroy();
}
function Lt(e) {
	let { useEffect: t, useRef: n, useState: r } = G().react, i = n(null), a = n(null), o = n(e), s = n(!1), [c, l] = r(!1), u = (e, t) => {
		s.current || (s.current = !0, console.warn(`[hdr-editing] The HDR preview was hidden: ${e}.`, t)), l(!0);
	};
	return t(() => {
		o.current = e;
	}), t(() => {
		let e = !0, t = i.current;
		if (t) return Ft(t, (t, n) => {
			e && u(t, n);
		}).then((n) => {
			if (!e) {
				n?.device.destroy();
				return;
			}
			if (!n) {
				u("WebGPU gave no adapter or canvas context");
				return;
			}
			a.current = n;
			let r = o.current;
			It(n, t, r.pair, r.headroom, r.weight);
		}).catch((t) => {
			e && u("the GPU could not be set up", t);
		}), () => {
			e = !1, a.current?.uniforms.destroy(), a.current?.device.destroy(), a.current = null;
		};
	}, []), t(() => {
		let t = a.current;
		if (t && i.current) try {
			It(t, i.current, e.pair, e.headroom, e.weight);
		} catch (e) {
			u("drawing failed", e);
		}
	}, [
		e.pair,
		e.headroom,
		e.weight
	]), c ? null : K("canvas", {
		ref: i,
		style: {
			position: "absolute",
			left: `${e.rect.x}px`,
			top: `${e.rect.y}px`,
			width: `${e.rect.w}px`,
			height: `${e.rect.h}px`,
			pointerEvents: "none"
		}
	});
}
//#endregion
//#region src/preview-support.ts
var Rt = {
	checking: "Checking the display…",
	"no-hdr-display": "This display isn't in HDR mode. Turn on HDR in the system's display settings.",
	"no-webgpu": "The HDR preview needs WebGPU, which isn't available here."
}, zt = "(dynamic-range: high)";
function Bt() {
	return {
		hdrDisplay: () => window.matchMedia(zt).matches,
		adapter: async () => !!await navigator.gpu?.requestAdapter()
	};
}
async function Vt(e = Bt()) {
	if (!e.hdrDisplay()) return "no-hdr-display";
	try {
		return await e.adapter() ? "ok" : "no-webgpu";
	} catch {
		return "no-webgpu";
	}
}
//#endregion
//#region src/store.ts
var Y = null;
function Ht() {
	Ut(), Y = G().stores.create((e, t) => ({
		pair: null,
		samples: null,
		panels: 0,
		preview: !1,
		visualize: !1,
		support: "checking",
		setPair: (n, r) => {
			let i = t().pair;
			i && i !== n && (i.sdr.close(), i.gain.close()), e({
				pair: n,
				samples: r
			});
		},
		panelMounted: () => (e({ panels: t().panels + 1 }), () => e({ panels: Math.max(0, t().panels - 1) })),
		setPreview: (t) => e({ preview: t }),
		setVisualize: (t) => e({ visualize: t }),
		setSupport: (t) => e({ support: t })
	}));
}
function X() {
	if (!Y) throw Error("[hdr-editing] store() called before activate()");
	return Y;
}
function Ut() {
	Y?.getState().setPair(null, null);
}
var Wt = null;
function Gt() {
	Kt();
	let e = 0, t = () => {
		let t = ++e;
		Vt().then((n) => {
			t === e && Y?.getState().setSupport(n);
		});
	}, n = window.matchMedia(zt);
	n.addEventListener("change", t), Wt = () => {
		e++, n.removeEventListener("change", t);
	}, t();
}
function Kt() {
	Wt?.(), Wt = null;
}
//#endregion
//#region src/visualize.ts
var qt = [
	[
		63,
		167,
		255
	],
	[
		76,
		217,
		100
	],
	[
		255,
		214,
		10
	],
	[
		255,
		55,
		95
	]
], Jt = .01, Z = [
	0,
	0,
	0
];
function Yt(e, n, r, a, s, c, l) {
	Z[0] = B[r], Z[1] = B[a], Z[2] = B[s];
	let u = t(Z), d = Math.log2(Math.max(o(u, c / 255, l, 1), 1e-6));
	if (d <= Jt) {
		let t = Math.round(Math.round(i(u) * 255) * .5);
		e[n] = t, e[n + 1] = t, e[n + 2] = t;
		return;
	}
	let f = qt[Math.min(3, Math.ceil(d) - 1)];
	e[n] = f[0], e[n + 1] = f[1], e[n + 2] = f[2];
}
function Xt(e, t, n) {
	let r = new Uint8ClampedArray(e.width * e.height * 4);
	for (let i = 0; i < e.width * e.height; i++) {
		let a = i * 4;
		Yt(r, a, e.data[a], e.data[a + 1], e.data[a + 2], t.data[a], n), r[a + 3] = 255;
	}
	return r;
}
//#endregion
//#region src/VisualizeLayer.ts
var Zt = 1024;
function Qt(e) {
	let { useEffect: t, useRef: n } = G().react, r = n(null);
	return t(() => {
		let t = r.current, n = H(e.pair.sdr, Zt), i = H(e.pair.gain, Zt);
		t && n && i && (t.width = n.width, t.height = n.height, t.getContext("2d")?.putImageData(new ImageData(Xt(n, i, e.headroom), n.width, n.height), 0, 0));
	}, [e.pair, e.headroom]), K("canvas", {
		ref: r,
		style: {
			position: "absolute",
			left: `${e.rect.x}px`,
			top: `${e.rect.y}px`,
			width: `${e.rect.w}px`,
			height: `${e.rect.h}px`,
			imageRendering: "pixelated",
			pointerEvents: "none"
		}
	});
}
var $t = "displayHeadroom", en = [
	"straighten",
	"crop",
	"transform"
], tn = ([e], [t]) => e < t ? -1 : +(e > t);
function nn(e) {
	return JSON.stringify(en.map((t) => e[t]), (e, t) => typeof t == "object" && t && !Array.isArray(t) ? Object.fromEntries(Object.entries(t).sort(tn)) : t);
}
function rn(e) {
	let t = null;
	if (e) try {
		let n = H(e.sdr, 256), r = H(e.gain, 256);
		n && r && (t = {
			sdr: n,
			gain: r
		});
	} catch (e) {
		console.warn("[hdr-editing] The histogram frame could not be read back.", e);
	}
	X().getState().setPair(e, t);
}
function an() {
	let { useEffect: e, useRef: t, useState: n } = G().react, r = G().stores.useDevelopStore, i = r((e) => e.photoId), a = r((e) => e.previewParams ?? e.params), o = r((e) => e.previewParamBag ?? e.paramBag), s = r((e) => e.activeTool !== "none" || e.cropping), c = r((e) => Object.keys(e.bypassedPanels).length > 0), { rect: l, nonce: u } = G().develop.useDevelopOverlay(), d = X()(), f = t(null), [, p] = n(0), m = _(o), h = !!i && m.on && x(a), g = d.preview && d.support === "ok", v = h && (d.panels > 0 || g || d.visualize);
	e(() => G().settings.onChange((e) => {
		e === "displayHeadroom" && p((e) => e + 1);
	}), []), e(() => {
		if (!v) return;
		let e = Mt({
			basis: () => {
				let e = r.getState();
				return {
					headroom: _(e.previewParamBag ?? e.paramBag).headroom,
					geometry: nn(e.previewParams ?? e.params)
				};
			},
			capture: (e) => {
				let t = r.getState();
				return G().develop.captureFrame(t.previewParams ?? t.params, e ? { paramBag: e } : void 0);
			}
		}, rn);
		return f.current = e, () => {
			e.stop(), f.current = null, Ut();
		};
	}, [v]), e(() => {
		let e = !1;
		return queueMicrotask(() => {
			e || f.current?.request(u);
		}), () => {
			e = !0;
		};
	}, [
		v,
		i,
		a,
		o,
		u,
		c
	]);
	let y = d.pair;
	if (!h || s || c || !l || !y || y.nonce !== u || y.geometry !== nn(a)) return null;
	let { headroom: b } = y, S = Pt(G().settings.get($t, 2), b);
	return K("div", { style: {
		position: "absolute",
		inset: 0,
		pointerEvents: "none"
	} }, g ? K(Lt, {
		key: "preview",
		pair: y,
		headroom: b,
		weight: S,
		rect: l
	}) : null, d.visualize ? K(Qt, {
		key: "visualize",
		pair: y,
		headroom: b,
		rect: l
	}) : null);
}
function on(e, n, r) {
	let i = Math.ceil(a(r)), s = (i - -8) * 4, c = new Uint32Array(s), l = 2 ** -8;
	for (let i = 0; i < e.width * e.height; i++) {
		let a = i * 4, u = t([
			B[e.data[a]],
			B[e.data[a + 1]],
			B[e.data[a + 2]]
		]), d = Math.log2(Math.max(o(u, n.data[a] / 255, r, 1), l)), f = Math.ceil((d - -8) * 4 - 1e-9) - 1;
		c[Math.min(s - 1, Math.max(0, f))]++;
	}
	return {
		bins: c,
		minStops: -8,
		maxStops: i,
		firstHdrBin: 32
	};
}
//#endregion
//#region src/HistogramView.ts
var Q = 56;
function sn() {
	let { useMemo: e } = G().react, t = X()((e) => e.samples), n = X()((e) => e.pair?.headroom), { tokens: r } = G().ui, i = e(() => t && n !== void 0 ? on(t.sdr, t.gain, n) : null, [t, n]);
	if (!i) return K("div", { style: {
		height: Q,
		fontSize: 11,
		color: r.textMuted,
		display: "flex",
		alignItems: "center",
		justifyContent: "center"
	} }, "No frame");
	let a = Math.max(1, ...i.bins), o = i.bins.length, s = Array.from(i.bins, (e, t) => K("rect", {
		key: t,
		x: t,
		width: .9,
		y: Q - Q * Math.sqrt(e) / Math.sqrt(a),
		height: Q * Math.sqrt(e) / Math.sqrt(a),
		fill: t < i.firstHdrBin ? r.textMuted : r.accent
	}));
	return K("svg", {
		viewBox: `0 0 ${o} ${Q}`,
		preserveAspectRatio: "none",
		style: {
			width: "100%",
			height: Q,
			display: "block"
		}
	}, ...s, K("line", {
		key: "white",
		x1: i.firstHdrBin,
		x2: i.firstHdrBin,
		y1: 0,
		y2: Q,
		stroke: r.textSecondary,
		strokeWidth: .4
	}));
}
//#endregion
//#region src/Panel.ts
var $ = { padding: "6px 8px 8px" };
function cn() {
	let { useEffect: e } = G().react, { Slider: t } = G().components, { Toggle: n, Section: r, Stack: i, tokens: a } = G().ui, o = G().stores.useDevelopStore, s = o((e) => e.paramBag), c = o((e) => e.params), l = o((e) => e.photoId), u = X()(), d = _(s), f = {
		margin: 0,
		fontSize: 10,
		lineHeight: 1.4,
		color: a.textMuted
	};
	e(() => X().getState().panelMounted(), []);
	let m = (e) => o.getState().setDynParams(e), h = (e) => void o.getState().commitEdit(`HDR ${e}`);
	if (!l) return K("div", { style: $ }, K("p", { style: f }, "Open a photo to edit its HDR."));
	if (!x(c)) return K("div", { style: $ }, K("p", { style: f }, "HDR needs the current processing. Use Update processing in the Develop status bar."));
	let g = (e, n, r, i, a) => K(t, {
		key: n,
		label: e,
		value: d[n],
		min: r,
		max: i,
		step: a,
		defaultValue: v[n],
		onChange: (e) => m({ [p[n]]: e }),
		onCommit: () => h(e.toLowerCase())
	}), b = u.support === "ok" ? null : Rt[u.support];
	return K(i, {
		gap: 8,
		style: $
	}, K(n, {
		key: "on",
		checked: d.on,
		label: "HDR",
		onChange: (e) => {
			m(y({ on: e })), h(e ? "on" : "off");
		}
	}), d.on ? K(sn, { key: "histogram" }) : null, d.on ? K(r, {
		key: "rendition",
		title: "Rendition"
	}, K(i, { gap: 1 }, g("Headroom", "headroom", .5, 4, .1), g("Start", "start", -3, 0, .05), g("Roll-off", "rolloff", .5, 4, .1), g("Highlight protection", "protection", 0, 100, 1))) : null, d.on ? K(r, {
		key: "view",
		title: "View"
	}, K(i, { gap: 4 }, K(n, {
		checked: u.preview && u.support === "ok",
		label: "HDR preview",
		onChange: (e) => X().getState().setPreview(e && u.support === "ok")
	}), b ? K("p", { style: f }, b) : null, K(n, {
		checked: u.visualize,
		label: "Visualize HDR",
		onChange: (e) => X().getState().setVisualize(e)
	}))) : null);
}
//#endregion
//#region src/glsl.ts
var ln = String(e), un = `float hdRho(float x, float startEv, float rolloffEv) {
  float k = exp2(clamp(startEv, -3.0, 0.0));
  float span = clamp(rolloffEv, 0.5, 4.0);
  float u = 3.0 * max(log2(max(x, 1e-12) / k), 0.0) / span;
  return 1.0 - (1.0 + u) * exp(-u);
}

float hdGate(float s, float protectionPct) {
  float pct = clamp(protectionPct, 0.0, 100.0);
  if (pct <= 0.0) return 1.0;
  float p = 0.5 * pct / 100.0;
  return smoothstep(0.5 * p, p, s);
}

float hdHeadroom(float h) {
  return floor(clamp(h, 0.5, 4.0) * 10.0 + 0.5) / 10.0;
}

float hdEncode(float s, float g, float headroomEv) {
  float corrected = log2((s * exp2(g) + ${ln}) / (s + ${ln}));
  return clamp(corrected / headroomEv, 0.0, 1.0);
}`, dn = "if (mode == 1) {\n  float hdS = luma(srgbToLinear(clamp(c, 0.0, 1.0)));\n  float hdH = hdHeadroom(headroom);\n  float hdG = on > 0.5 ? hdH * hdRho(slSceneLuma, start, rolloff) * hdGate(hdS, protection) : 0.0;\n  c = vec3(hdEncode(hdS, hdG, hdH));\n}";
//#endregion
//#region src/stage.ts
function fn() {
	return {
		id: c,
		name: "HDR",
		phase: "output-encode",
		priority: 1e3,
		space: { encoding: "perceptual" },
		glsl: dn,
		helpers: un,
		uniforms: f.map((e) => ({
			key: e.key,
			glslType: e.type,
			default: e.def,
			range: {
				min: e.min,
				max: e.max,
				step: e.step
			},
			label: e.label
		})),
		presetScope: "global"
	};
}
//#endregion
//#region src/index.ts
function pn() {
	let e = G().stores.useDevelopStore.getState();
	e.setDynParams(b()), e.commitEdit("HDR reset");
}
function mn(e) {
	Ze(e), Ht(), Gt(), e.registerProcessingStage(fn()), e.registerPanel({
		id: l,
		title: "HDR",
		component: cn,
		defaultDock: {
			module: "develop",
			direction: "right",
			order: 5.5,
			width: 280
		},
		onReset: pn
	}), e.registerSlot({
		id: u,
		slot: "develop-canvas-overlay",
		component: an,
		order: 50
	}), e.registerSettings({
		title: "HDR Editing",
		keywords: [
			"hdr",
			"headroom",
			"display"
		],
		fields: [{
			key: $t,
			label: "Display headroom (stops)",
			hint: "How far above SDR white your display can go. The HDR preview scales its highlights to fit; no system API reports it.",
			type: "number",
			default: 2,
			min: .5,
			max: 4,
			step: .1
		}]
	}), e.registerExportProcessor({
		id: d,
		label: "HDR",
		settings: vt,
		process: (e, t, n, r) => At(e, t, n, r, jt())
	});
}
function hn() {
	T.stop(), qe(), Kt();
	try {
		Ut();
		let e = G();
		e.unregisterProcessingStage(fn().id), e.unregisterSlot(u);
	} catch {}
}
//#endregion
export { mn as activate, hn as deactivate };

//# sourceMappingURL=index.js.map