//#region src/runtime.ts
var e = null;
function t(t) {
	e = t;
}
function n() {
	if (!e) throw Error("[hdr-editing] api() called before activate()");
	return e;
}
function r(e, t, ...r) {
	return n().react.createElement(e, t, ...r);
}
//#endregion
//#region src/avif-worker-client.ts
function i() {
	return new Worker(n().assetUrl("dist/avif-worker.js"), { type: "module" });
}
function a() {
	return {
		glue: n().assetUrl("dist/avif_enc.js"),
		wasm: n().assetUrl("dist/avif_enc.wasm")
	};
}
var o = (...e) => e.map((e) => e.data.buffer).filter((e) => e instanceof ArrayBuffer);
function s(e, t) {
	let n = null, r = 1, i = /* @__PURE__ */ new Map();
	function a(e) {
		n?.terminate(), n = null;
		let t = /* @__PURE__ */ Error(e ? `the AVIF worker stopped: ${e}` : "the AVIF worker stopped");
		for (let e of i.values()) e.reject(t);
		i.clear();
	}
	function s() {
		let t = e();
		return t.onmessage = ({ data: e }) => {
			let t = i.get(e.id);
			t && (i.delete(e.id), "avif" in e ? t.resolve(e.avif) : t.reject(Error(e.error)));
		}, t.onerror = (e) => {
			e.preventDefault(), n === t && a(e.message);
		}, t.onmessageerror = () => {
			n === t && a("an answer couldn't be read");
		}, t;
	}
	return {
		encode: (e, a, c, l) => new Promise((u, d) => {
			let f = r++;
			try {
				n ??= s(), i.set(f, {
					resolve: u,
					reject: d
				}), n.postMessage({
					id: f,
					sdr: e,
					gain: a,
					headroom: c,
					quality: l,
					encoder: t()
				}, o(e, a));
			} catch (e) {
				i.delete(f), d(e);
			}
		}),
		stop: () => a()
	};
}
var c = s(i, a), l = (e, t) => String.fromCharCode(e[t], e[t + 1], e[t + 2], e[t + 3]);
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
//#endregion
//#region src/avif-exif.ts
var m = (e, t) => String.fromCharCode(e[t], e[t + 1], e[t + 2], e[t + 3]);
function h(e, t, n) {
	let r = new DataView(e.buffer, e.byteOffset, e.byteLength), i = [], a = t;
	for (; a < n;) {
		if (a + 8 > n) return null;
		let t = r.getUint32(a);
		if (t < 8 || a + t > n) return null;
		i.push({
			type: m(e, a + 4),
			start: a,
			content: a + 8,
			end: a + t
		}), a += t;
	}
	return i;
}
function g(e, t, n) {
	let r = 0;
	for (let i = 0; i < n; i++) r = r * 256 + e[t + i];
	return r;
}
function _(e, t) {
	let n = [];
	for (let r = t - 1; r >= 0; r--) n.push(Math.floor(e / 2 ** (8 * r)) % 256);
	return n;
}
var v = (e, t) => e < 2 ** (8 * t);
function y(e, ...t) {
	let n = 8 + t.reduce((e, t) => e + t.length, 0), r = new Uint8Array(n);
	r.set(_(n, 4)), r.set(new TextEncoder().encode(e), 4);
	let i = 8;
	for (let e of t) r.set(e, i), i += e.length;
	return r;
}
var b = [
	0,
	4,
	8
];
function ee(e, t) {
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
	].every((e) => b.includes(e))) return null;
	let l = i === 2, u = g(e, n, l ? 4 : 2);
	n += l ? 4 : 2;
	let d = [];
	for (let t = 0; t < u; t++) {
		if (!r(l ? 4 : 2)) return null;
		let t = g(e, n, l ? 4 : 2);
		n += l ? 4 : 2;
		let u = 0;
		if (i > 0) {
			if (!r(2)) return null;
			u = g(e, n, 2) & 15, n += 2;
		}
		if (!r(4 + s)) return null;
		let f = g(e, n, 2), p = g(e, n + 2, s), m = g(e, n + 2 + s, 2);
		n += 4 + s;
		let h = [];
		for (let t = 0; t < m; t++) {
			if (!r(c + a + o)) return null;
			h.push({
				index: g(e, n, c),
				offset: g(e, n + c, a),
				length: g(e, n + c + a, o)
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
function te(e) {
	let t = e.version === 2, n = [];
	for (let r of e.entries) {
		n.push(..._(r.id, t ? 4 : 2)), e.version > 0 && n.push(..._(r.method, 2)), n.push(..._(r.dataReference, 2), ..._(r.base, e.baseOffsetSize), ..._(r.extents.length, 2));
		for (let t of r.extents) n.push(..._(t.index, e.indexSize), ..._(t.offset, e.offsetSize), ..._(t.length, e.lengthSize));
	}
	return y("iloc", [
		e.version,
		0,
		0,
		0,
		e.offsetSize << 4 | e.lengthSize,
		e.baseOffsetSize << 4 | e.indexSize
	], _(e.entries.length, t ? 4 : 2), n);
}
function x(e) {
	let t = h(e, 0, e.length)?.find((e) => e.type === "meta");
	if (!t || t.end - t.content < 4 || e[t.content] !== 0) return null;
	let n = h(e, t.content + 4, t.end);
	return n && {
		box: t,
		children: n
	};
}
function ne(e, t) {
	let n = e[t.content] === 1;
	return t.end - t.content >= (n ? 8 : 6) ? g(e, t.content + 4, n ? 4 : 2) : null;
}
function re(e, t) {
	let n = e[t.content];
	if (n > 1) return null;
	let r = n === 0 ? 2 : 4, i = t.content + 4, a = h(e, i + r, t.end);
	if (!a || g(e, i, r) !== a.length) return null;
	let o = [];
	for (let t of a) {
		if (t.type !== "infe") return null;
		let n = e[t.content];
		if (n < 2) o.push({
			id: g(e, t.content + 4, 2),
			type: null
		});
		else {
			let r = n === 3 ? 4 : 2;
			if (t.end - t.content < 4 + r + 2 + 4) return null;
			o.push({
				id: g(e, t.content + 4, r),
				type: m(e, t.content + 4 + r + 2)
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
function ie(e, t) {
	let n = e[t.content];
	if (n > 1) return null;
	let r = n === 0 ? 2 : 4, i = h(e, t.content + 4, t.end);
	if (!i) return null;
	let a = /* @__PURE__ */ new Map();
	for (let t of i) {
		if (t.type !== "cdsc") continue;
		if (t.end - t.content < r + 2) return null;
		let n = g(e, t.content + r, 2);
		if (t.end - t.content < r + 2 + n * r) return null;
		let i = [];
		for (let a = 0; a < n; a++) i.push(g(e, t.content + r + 2 + a * r, r));
		a.set(g(e, t.content, r), i);
	}
	return a;
}
function S(e) {
	let t = /* @__PURE__ */ new Map(), n = x(e)?.children.find((e) => e.type === "iloc"), r = n && ee(e, n);
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
function ae(e) {
	let t = x(e), n = t?.children.find((e) => e.type === "iinf"), r = t?.children.find((e) => e.type === "iref"), i = (n && re(e, n))?.items.find((e) => e.type === "Exif"), a = r && ie(e, r), o = i && S(e).get(i.id), s = i && a?.get(i.id)?.[0];
	if (!o || o.length < 4 || s === void 0) return null;
	let c = g(o, 0, 4);
	return 4 + c <= o.length ? {
		tiff: o.subarray(4 + c),
		describes: s
	} : null;
}
var C = (e, t) => e.length === t.length && e.every((e, n) => e === t[n]);
function w(e, t) {
	if (t.length === 0) return null;
	let n = x(e);
	if (!n) return null;
	let r = (e) => n.children.find((t) => t.type === e), [i, a, o, s] = [
		r("pitm"),
		r("iloc"),
		r("iinf"),
		r("iref")
	];
	if (!i || !a || !o) return null;
	let c = ne(e, i), l = ee(e, a), u = re(e, o);
	if (s && e[s.content] > 1 || c === null || !l || !u) return null;
	let d = Math.max(...u.items.map((e) => e.id), ...l.entries.map((e) => e.id)) + 1;
	if (d >= 2 ** 16 || l.offsetSize === 0 || l.lengthSize === 0) return null;
	let f = y("infe", [
		2,
		0,
		0,
		0
	], _(d, 2), [0, 0], Array.from(new TextEncoder().encode("Exif\0"))), p = y("iinf", [
		u.version,
		0,
		0,
		0
	], _(u.items.length + 1, u.countSize), e.subarray(u.countAt + u.countSize, o.end), f), m = s ? e[s.content] === 1 : c >= 2 ** 16, h = y("cdsc", _(d, m ? 4 : 2), _(1, 2), _(c, m ? 4 : 2)), g = s ? y("iref", Array.from(e.subarray(s.content, s.end)), h) : y("iref", [
		+!!m,
		0,
		0,
		0
	], h), b = l.version === 2 ? 4 : 2, ie = l.version > 0 ? 2 : 0, S = l.indexSize + l.offsetSize + l.lengthSize, ae = b + ie + 2 + l.baseOffsetSize + 2 + S, C = (e) => e.end - e.start, w = p.length - C(o) + g.length - (s ? C(s) : 0) + ae, T = new Uint8Array(4 + t.length);
	T.set(t, 4);
	let se = e.length + w + 8, E = {
		...l,
		entries: l.entries.map((e) => e.method !== 0 || e.dataReference !== 0 || !e.extents.some((t) => e.base + t.offset >= n.box.end) ? e : l.baseOffsetSize > 0 ? {
			...e,
			base: e.base + w
		} : {
			...e,
			extents: e.extents.map((e) => ({
				...e,
				offset: e.offset + w
			}))
		})
	};
	if (E.entries.push({
		id: d,
		method: 0,
		dataReference: 0,
		base: 0,
		extents: [{
			index: 0,
			offset: se,
			length: T.length
		}]
	}), !E.entries.every((e) => v(e.base, l.baseOffsetSize) && e.extents.every((e) => v(e.offset, l.offsetSize) && v(e.length, l.lengthSize)))) return null;
	let D = [];
	for (let t of n.children) t === a ? D.push(te(E)) : t === o ? D.push(p) : t === s ? D.push(g) : D.push(e.subarray(t.start, t.end)), t === o && !s && D.push(g);
	let O = y("meta", Array.from(e.subarray(n.box.content, n.box.content + 4)), ...D);
	if (O.length - C(n.box) !== w) return null;
	let k = y("mdat", T), A = new Uint8Array(e.length + w + k.length);
	return A.set(e.subarray(0, n.box.start)), A.set(O, n.box.start), A.set(e.subarray(n.box.end), n.box.start + O.length), A.set(k, e.length + w), oe(e, A, t, c) ? A : null;
}
function oe(e, t, n, r) {
	if (!h(t, 0, t.length)) return !1;
	let i = S(t);
	for (let [t, n] of S(e)) {
		let e = i.get(t);
		if (!e || !C(e, n)) return !1;
	}
	let a = ae(t);
	return a !== null && a.describes === r && C(a.tiff, n);
}
//#endregion
//#region src/jpeg.ts
function T(e) {
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
var se = (e) => e >= 192 && e <= 207 && e !== 196 && e !== 200 && e !== 204;
function E(e) {
	try {
		let { segments: t } = T(e), n = t.find((e) => se(e.marker));
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
function D(e, t) {
	return e.subarray(t.start + 4, t.end);
}
function O(e, t) {
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
function k(e) {
	let t = new Uint8Array(e.reduce((e, t) => e + t.length, 0)), n = 0;
	for (let r of e) t.set(r, n), n += r.length;
	return t;
}
var A = (e) => new TextEncoder().encode(e);
function j(e, t) {
	if (e.length < t.length) return !1;
	for (let n = 0; n < t.length; n++) if (e[n] !== t[n]) return !1;
	return !0;
}
//#endregion
//#region src/exif.ts
var M = Uint8Array.of(69, 120, 105, 102, 0, 0), ce = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), N = (e, t) => String.fromCharCode(e[t], e[t + 1], e[t + 2], e[t + 3]);
function le(e) {
	if (e.length < 8) return null;
	let t = e[0] === 73 && e[1] === 73 && e[2] === 42 && e[3] === 0, n = e[0] === 77 && e[1] === 77 && e[2] === 0 && e[3] === 42;
	return t || n ? e : null;
}
function ue(e) {
	for (let t of T(e).segments) {
		if (t.marker !== 225) continue;
		let n = D(e, t);
		if (j(n, M)) return n.subarray(M.length);
	}
	return null;
}
function de(e) {
	let t = new DataView(e.buffer, e.byteOffset, e.byteLength), n = ce.length;
	for (; n + 12 <= e.length;) {
		let r = t.getUint32(n), i = n + 8;
		if (i + r + 4 > e.length) return null;
		if (N(e, n + 4) === "eXIf") return e.subarray(i, i + r);
		n = i + r + 4;
	}
	return null;
}
function fe(e) {
	let t = new DataView(e.buffer, e.byteOffset, e.byteLength), n = 12;
	for (; n + 8 <= e.length;) {
		let r = t.getUint32(n + 4, !0), i = n + 8;
		if (i + r > e.length) return null;
		if (N(e, n) === "EXIF") {
			let t = e.subarray(i, i + r);
			return j(t, M) ? t.subarray(M.length) : t;
		}
		n = i + r + r % 2;
	}
	return null;
}
function pe(e) {
	return e[0] === 255 && e[1] === 216 ? ue(e) : j(e, ce) ? de(e) : e.length >= 12 && N(e, 0) === "RIFF" && N(e, 8) === "WEBP" ? fe(e) : null;
}
function me(e) {
	try {
		let t = pe(e);
		return t && le(t);
	} catch {
		return null;
	}
}
//#endregion
//#region src/model.ts
var P = 1 / 64, he = (e) => .2126 * e[0] + .7152 * e[1] + .0722 * e[2], ge = (e) => e < 0 ? 0 : e > 1 ? 1 : e;
function _e(e) {
	return e < .04045 ? e / 12.92 : ((e + .055) / 1.055) ** 2.4;
}
function ve(e) {
	let t = ge(e);
	return t < .0031308 ? t * 12.92 : 1.055 * t ** (1 / 2.4) - .055;
}
function F(e) {
	return Math.floor(Math.min(4, Math.max(.5, e)) * 10 + .5) / 10;
}
function ye(e, t, n, r) {
	return (e + P) * 2 ** (t * F(n) * r) - P;
}
//#endregion
//#region src/frame.ts
var I = Float64Array.from({ length: 256 }, (e, t) => _e(t / 255)), L = null;
function R(e, t) {
	let { width: n, height: r } = e;
	if (n < 2 || r < 2) return null;
	let i = Math.min(1, t / Math.max(n, r)), a = Math.max(1, Math.round(n * i)), o = Math.max(1, Math.round(r * i));
	L ||= new OffscreenCanvas(a, o), L.width !== a && (L.width = a), L.height !== o && (L.height = o);
	let s = L.getContext("2d", { willReadFrequently: !0 });
	return s ? (s.globalCompositeOperation = "copy", s.imageSmoothingQuality = "high", s.drawImage(e, 0, 0, a, o), {
		data: s.getImageData(0, 0, a, o).data,
		width: a,
		height: o
	}) : null;
}
function be(e, t, n) {
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
var xe = Int32Array.from([
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
]), Se = [
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
], Ce = [
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
], we = [
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
], Te = [
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
], Ee = [
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
], z = /* @__PURE__ */ new Float64Array(64);
for (let e = 0; e < 8; e++) for (let t = 0; t < 8; t++) z[e * 8 + t] = (e === 0 ? Math.SQRT1_2 : 1) * Math.cos((2 * t + 1) * e * Math.PI / 16) / 2;
function De(e) {
	let t = Math.min(100, Math.max(1, Math.round(e))), n = t < 50 ? Math.floor(5e3 / t) : 200 - 2 * t;
	return Uint8Array.from(Se, (e) => Math.min(255, Math.max(1, Math.floor((e * n + 50) / 100))));
}
function Oe(e, t) {
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
var ke = class {
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
}, Ae = (e) => e === 0 ? 0 : 32 - Math.clz32(Math.abs(e)), je = (e, t) => e < 0 ? e + (1 << t) - 1 : e;
function Me(e, t, n) {
	for (let n = 0; n < 8; n++) for (let r = 0; r < 8; r++) {
		let i = 0;
		for (let t = 0; t < 8; t++) i += e[n * 8 + t] * z[r * 8 + t];
		t[n * 8 + r] = i;
	}
	for (let e = 0; e < 8; e++) for (let r = 0; r < 8; r++) {
		let i = 0;
		for (let n = 0; n < 8; n++) i += t[n * 8 + r] * z[e * 8 + n];
		n[e * 8 + r] = i;
	}
}
function Ne(e, t, n, r = 90) {
	let i = De(r), a = Oe(Ce, we), o = Oe(Te, Ee), s = new ke(), c = /* @__PURE__ */ new Float64Array(64), l = /* @__PURE__ */ new Float64Array(64), u = /* @__PURE__ */ new Float64Array(64), d = /* @__PURE__ */ new Int32Array(64), f = 0;
	for (let r = 0; r < n; r += 8) for (let p = 0; p < t; p += 8) {
		for (let i = 0; i < 8; i++) {
			let a = Math.min(r + i, n - 1) * t;
			for (let n = 0; n < 8; n++) c[i * 8 + n] = e[a + Math.min(p + n, t - 1)] - 128;
		}
		Me(c, l, u);
		for (let e = 0; e < 64; e++) {
			let t = xe[e], n = Math.round(u[t] / i[t]);
			d[e] = e === 0 ? n : Math.max(-1023, Math.min(1023, n));
		}
		let m = d[0] - f;
		f = d[0];
		let h = Ae(m);
		s.write(a.code[h], a.size[h]), h > 0 && s.write(je(m, h), h);
		let g = 0;
		for (let e = 1; e < 64; e++) {
			let t = d[e];
			if (t === 0) {
				g++;
				continue;
			}
			for (; g > 15;) s.write(o.code[240], o.size[240]), g -= 16;
			let n = Ae(t), r = g << 4 | n;
			s.write(o.code[r], o.size[r]), s.write(je(t, n), n), g = 0;
		}
		g > 0 && s.write(o.code[0], o.size[0]);
	}
	let p = /* @__PURE__ */ new Uint8Array(65);
	for (let e = 0; e < 64; e++) p[1 + e] = i[xe[e]];
	return k([
		Uint8Array.of(255, 216),
		O(224, Uint8Array.of(74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0)),
		O(219, p),
		O(192, Uint8Array.of(8, n >> 8, n & 255, t >> 8, t & 255, 1, 1, 17, 0)),
		O(196, Uint8Array.from([
			0,
			...Ce,
			...we,
			16,
			...Te,
			...Ee
		])),
		O(218, Uint8Array.of(1, 1, 0, 0, 63, 0)),
		s.bytes(),
		Uint8Array.of(255, 217)
	]);
}
//#endregion
//#region src/params.ts
var B = "hdr-editing", Pe = `${B}.gain`, Fe = `${B}.panel`, Ie = `${B}.overlay`, Le = `${B}.export`, V = [
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
], H = Object.fromEntries(V.map((e) => [e.key, `${Pe}.${e.key}`])), Re = { [H.mode]: 1 }, ze = (e) => V.find((t) => t.key === e);
function U(e, t) {
	let n = ze(t), r = e[H[t]];
	return typeof r != "number" || !Number.isFinite(r) ? n.def : Math.min(n.max, Math.max(n.min, r));
}
function W(e) {
	return {
		on: U(e, "on") > .5,
		headroom: F(U(e, "headroom")),
		start: U(e, "start"),
		rolloff: U(e, "rolloff"),
		protection: U(e, "protection")
	};
}
var Be = W({});
function Ve(e) {
	let t = {};
	return e.on !== void 0 && (t[H.on] = +!!e.on), e.headroom !== void 0 && (t[H.headroom] = e.headroom), e.start !== void 0 && (t[H.start] = e.start), e.rolloff !== void 0 && (t[H.rolloff] = e.rolloff), e.protection !== void 0 && (t[H.protection] = e.protection), t;
}
function He() {
	return Ve(Be);
}
function G(e) {
	if (typeof e != "object" || !e) return !1;
	let t = e.processVersion;
	return typeof t == "number" && t >= 2;
}
//#endregion
//#region src/pq.ts
function Ue(e, t) {
	if (t.width !== e.width || t.height !== e.height) throw Error(`[hdr-editing] the gain map is ${t.width}x${t.height}, the image ${e.width}x${e.height}`);
}
//#endregion
//#region src/ultrahdr.ts
var We = A("http://ns.adobe.com/xap/1.0/\0"), Ge = A("urn:iso:std:iso:ts:21496:-1\0"), Ke = A("MPF\0"), qe = A("Exif\0\0"), Je = A("ICC_PROFILE\0"), Ye = 224, K = 225, q = 226, Xe = 237, Ze = 90, J = (e) => String(Number(e.toPrecision(6)));
function Qe(e) {
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
function $e(e) {
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
		`      hdrgm:GainMapMax="${J(e)}"`,
		"      hdrgm:Gamma=\"1\"",
		`      hdrgm:OffsetSDR="${J(P)}"`,
		`      hdrgm:OffsetHDR="${J(P)}"`,
		"      hdrgm:HDRCapacityMin=\"0\"",
		`      hdrgm:HDRCapacityMax="${J(e)}"`,
		"      hdrgm:BaseRenditionIsHDR=\"False\"/>",
		"  </rdf:RDF>",
		"</x:xmpmeta>",
		""
	].join("\n");
}
var et = (e, t) => t === 0 ? e : et(t, e % t);
function tt(e) {
	let t = Math.round(e * 10), n = et(t, 10);
	return [t / n, 10 / n];
}
function nt() {
	return O(q, new Uint8Array([
		...Ge,
		0,
		0,
		0,
		0
	]));
}
function rt(e) {
	let t = /* @__PURE__ */ new Uint8Array(61), n = new DataView(t.buffer), [r, i] = tt(e);
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
function it(e, t, n) {
	let r = /* @__PURE__ */ new Uint8Array(86), i = new DataView(r.buffer);
	return r.set(Ke, 0), r.set([
		77,
		77,
		0,
		42
	], 4), i.setUint32(8, 8), i.setUint16(12, 3), i.setUint16(14, 45056), i.setUint16(16, 7), i.setUint32(18, 4), r.set(A("0100"), 22), i.setUint16(26, 45057), i.setUint16(28, 4), i.setUint32(30, 1), i.setUint32(34, 2), i.setUint16(38, 45058), i.setUint16(40, 7), i.setUint32(42, 32), i.setUint32(46, 50), i.setUint32(50, 0), i.setUint32(54, 196608), i.setUint32(58, e), i.setUint32(62, 0), i.setUint32(70, 0), i.setUint32(74, t), i.setUint32(78, n), O(q, r);
}
function at(e, t) {
	let n = D(e, t);
	return t.marker === Ye ? "jfif" : t.marker === K && j(n, qe) ? "exif" : t.marker === q && j(n, Je) ? "icc" : t.marker === Xe ? "keep" : t.marker >= 224 && t.marker <= 239 ? "drop" : "table";
}
function ot(e, t) {
	let n = t + 2 + (e[t + 2] << 8 | e[t + 3]);
	for (let t = n; t + 1 < e.length; t++) if (e[t] === 255 && e[t + 1] === 217) return t + 2;
	throw Error("[hdr-editing] JPEG has no end of image");
}
function st(e, t, n) {
	if (!Number.isFinite(n)) throw Error(`[hdr-editing] headroom ${n} is not a number`);
	if (t.length < 2 || t[0] !== 255 || t[1] !== 216) throw Error("[hdr-editing] the gain map is not a JPEG");
	let r = F(n), i = k([
		Uint8Array.of(255, 216),
		O(K, new Uint8Array([...We, ...A($e(r))])),
		O(q, new Uint8Array([...Ge, ...rt(r)])),
		t.subarray(2)
	]), { segments: a, scan: o } = T(e), s = (t) => a.filter((n) => at(e, n) === t).map((t) => e.subarray(t.start, t.end)), c = k([
		Uint8Array.of(255, 216),
		...s("jfif"),
		...s("exif"),
		O(K, new Uint8Array([...We, ...A(Qe(i.length))])),
		...s("icc"),
		nt(),
		...s("keep"),
		...s("table")
	]), l = e.subarray(o, ot(e, o)), u = c.length + Ze + l.length;
	return k([
		c,
		it(u, i.length, u - (c.length + 8)),
		l,
		i
	]);
}
function ct(e) {
	let [t] = e;
	return e.length === 1 ? `${t.label} ${t.problem}` : `${e.length} photos didn't export as asked. First: ${t.label} ${t.problem}`;
}
var lt = 3e5;
function ut(e, t = Date.now) {
	let n = [], r = 0, i = null;
	return {
		add(a, o) {
			let s = t();
			s - r > lt && (n = []), r = s, n.push({
				label: a,
				problem: o
			}), i?.close(), i = e({
				message: ct(n),
				tone: "warning"
			});
		},
		clear() {
			n = [], i?.close(), i = null;
		}
	};
}
var dt = ut((e) => n().ui.notify(e)), ft = 80, pt = [{
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
	default: ft,
	min: 1,
	max: 100,
	step: 1
}], mt = (e, t) => new Blob([new Uint8Array(e)], { type: t });
function ht(e) {
	let t = new Uint8Array(e.width * e.height);
	for (let n = 0; n < t.length; n++) t[n] = e.data[n * 4];
	return t;
}
function gt(e, t) {
	let n = typeof e == "number" ? Math.trunc(e) : NaN;
	return Number.isNaN(n) ? t - 1 : Math.min(Math.max(n, 0), t - 1);
}
function _t(e) {
	let t = typeof e == "string" && e.trim() !== "" ? Number(e) : e;
	return typeof t != "number" || !Number.isFinite(t) ? ft : Math.min(100, Math.max(1, Math.round(t)));
}
async function vt(e, t, n) {
	let r = await n.renderGainMap(e, t), i = r && await n.decode(r);
	if (!i) throw Error("the gain map didn't render");
	return i;
}
function yt(e, t, n, r) {
	return r.warn(`[hdr-editing] HDR export of ${t.id} failed, exported without HDR: ${n}`), r.notify(t, `was exported without HDR: ${n}`), e;
}
function bt(e, t) {
	return Math.abs(e.width * t.height - e.height * t.width) <= t.width + t.height;
}
async function xt(e, t, n, r, i) {
	if (e.type !== "image/jpeg") return yt(e, t, "Ultra HDR needs the JPEG export format", i);
	let a = new Uint8Array(await e.arrayBuffer()), o = E(a);
	if (!o) throw Error("the exported JPEG has no size");
	let s = await vt(t, r, i);
	if (!bt(s, o)) throw Error(`the gain map came out ${s.width}×${s.height}, not the shape of the ${o.width}×${o.height} image`);
	return mt(st(a, Ne(ht(s), s.width, s.height, 90), n.headroom), "image/jpeg");
}
async function St(e, t, n, r, i, a) {
	if (e.type !== "image/jpeg" && e.type !== "image/png" && e.type !== "image/webp") return yt(e, t, "HDR AVIF needs the JPEG, PNG or WebP export format", a);
	let o = await Ct(e, t, i, a), s = await vt(t, i.longEdge, a);
	if (!bt(s, o)) throw Error(`the gain map came out ${s.width}×${s.height}, not the shape of the ${o.width}×${o.height} image`);
	let c = be(s, o.width, o.height);
	Ue(o, c);
	let l = await a.encodeAvif(o, c, n.headroom, r);
	if (!p(l)) throw Error("the AVIF has no colour box to mark as PQ");
	return mt(await wt(l, e, t, a), "image/avif");
}
async function Ct(e, t, n, r) {
	if (!n.settings) {
		let t = await r.decodeFile(e);
		if (!t) throw Error("the exported file didn't decode");
		return t;
	}
	let i = await r.renderBase(t, n.settings), a = i && await r.decode(i);
	if (!a) throw Error("the base image didn't render");
	return a;
}
async function wt(e, t, n, r) {
	let i = me(new Uint8Array(await t.arrayBuffer()));
	return i ? w(e, i) || (r.warn(`[hdr-editing] the Exif metadata of ${n.id} couldn't be added to its HDR AVIF.`), r.notify(n, "was exported without its metadata: the HDR AVIF couldn't take it"), e) : e;
}
async function Tt(e, t, n, r, i) {
	let a = n.output;
	if (a !== "ultrahdr" && a !== "avif") return e;
	try {
		let o = await i.edit(t.id);
		if (!o || !G(o.params)) return e;
		let s = W(o.bag);
		return s.on ? a === "ultrahdr" ? await xt(e, t, s, r.longEdge, i) : await St(e, t, s, _t(n.avifQuality), r, i) : e;
	} catch (n) {
		return yt(e, t, n instanceof Error ? n.message : String(n), i);
	}
}
function Et() {
	let e = n();
	return {
		edit: async (t) => {
			let n = await e.catalog.getEditState(t);
			if (!n || n.stack.length === 0) return null;
			let r = n.stack[gt(n.currentIndex, n.stack.length)];
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
			}, void 0, { paramBag: { ...Re } });
			return r?.blob ?? null;
		},
		decode: async (e) => {
			let t = await createImageBitmap(e, {
				colorSpaceConversion: "none",
				premultiplyAlpha: "none"
			});
			try {
				return R(t, Infinity);
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
				return R(t, Infinity);
			} finally {
				t.close();
			}
		},
		encodeAvif: (e, t, n, r) => c.encode(e, t, n, r),
		warn: (e) => console.warn(e),
		notify: (e, t) => {
			try {
				dt.add(e.filename ?? e.id, t);
			} catch (e) {
				console.warn(`[hdr-editing] couldn't show the export notice: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	};
}
//#endregion
//#region src/frames.ts
function Dt(e, t) {
	let n = !1, r = null, i = !1, a = (t) => {
		try {
			return e.capture(t);
		} catch (e) {
			return Promise.reject(e);
		}
	}, o = async (t) => {
		let n = e.basis(), [r, i] = await Promise.allSettled([a(), a({ ...Re })]), o = r.status === "fulfilled" ? r.value : null, s = i.status === "fulfilled" ? i.value : null;
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
var Ot = "\nstruct Params { headroom: f32, weight: f32, offset: f32, pad: f32 };\n@group(0) @binding(0) var sdrTex: texture_2d<f32>;\n@group(0) @binding(1) var gainTex: texture_2d<f32>;\n@group(0) @binding(2) var<uniform> params: Params;\n\nstruct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };\n\n@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {\n  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));\n  var out: VOut;\n  out.pos = vec4f(p[i], 0.0, 1.0);\n  out.uv = vec2f((p[i].x + 1.0) * 0.5, (1.0 - p[i].y) * 0.5);\n  return out;\n}\n\nfn decode(c: vec3f) -> vec3f {\n  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c < vec3f(0.04045));\n}\n\nfn encodeExtended(v: vec3f) -> vec3f {\n  let a = abs(v);\n  let e = select(1.055 * pow(a, vec3f(1.0 / 2.4)) - 0.055, a * 12.92, a < vec3f(0.0031308));\n  return sign(v) * e;\n}\n\nfn texel(t: texture_2d<f32>, uv: vec2f) -> vec4f {\n  let size = vec2f(textureDimensions(t));\n  return textureLoad(t, vec2i(clamp(uv * size, vec2f(0.0), size - 1.0)), 0);\n}\n\n@fragment fn fs(in: VOut) -> @location(0) vec4f {\n  let sdr = decode(texel(sdrTex, in.uv).rgb);\n  let r = texel(gainTex, in.uv).r;\n  let hdr = (sdr + params.offset) * exp2(r * params.headroom * params.weight) - params.offset;\n  return vec4f(encodeExtended(hdr), 1.0);\n}\n";
function kt(e, t) {
	return Math.min(1, Math.max(0, e / F(t)));
}
//#endregion
//#region src/PreviewLayer.ts
async function At(e, t) {
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
		let o = r.createShaderModule({ code: Ot }), s = r.createRenderPipeline({
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
function jt(e, t, n, r, i) {
	if (n.sdr.width === 0 || n.gain.width === 0) return;
	let { device: a, context: o, pipeline: s, uniforms: c } = e;
	t.width !== n.sdr.width && (t.width = n.sdr.width), t.height !== n.sdr.height && (t.height = n.sdr.height);
	let l = (e) => {
		let t = a.createTexture({
			size: [e.width, e.height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
		});
		return a.queue.copyExternalImageToTexture({ source: e }, { texture: t }, [e.width, e.height]), t;
	}, u = l(n.sdr), d = l(n.gain);
	a.queue.writeBuffer(c, 0, new Float32Array([
		F(r),
		i,
		P,
		0
	]));
	let f = a.createBindGroup({
		layout: s.getBindGroupLayout(0),
		entries: [
			{
				binding: 0,
				resource: u.createView()
			},
			{
				binding: 1,
				resource: d.createView()
			},
			{
				binding: 2,
				resource: { buffer: c }
			}
		]
	}), p = a.createCommandEncoder(), m = p.beginRenderPass({ colorAttachments: [{
		view: o.getCurrentTexture().createView(),
		loadOp: "clear",
		storeOp: "store",
		clearValue: {
			r: 0,
			g: 0,
			b: 0,
			a: 1
		}
	}] });
	m.setPipeline(s), m.setBindGroup(0, f), m.draw(3), m.end(), a.queue.submit([p.finish()]), u.destroy(), d.destroy();
}
function Mt(e) {
	let { useEffect: t, useRef: i, useState: a } = n().react, o = i(null), s = i(null), c = i(e), l = i(!1), [u, d] = a(!1), f = (e, t) => {
		l.current || (l.current = !0, console.warn(`[hdr-editing] The HDR preview was hidden: ${e}.`, t)), d(!0);
	};
	return t(() => {
		c.current = e;
	}), t(() => {
		let e = !0, t = o.current;
		if (t) return At(t, (t, n) => {
			e && f(t, n);
		}).then((n) => {
			if (!e) {
				n?.device.destroy();
				return;
			}
			if (!n) {
				f("WebGPU gave no adapter or canvas context");
				return;
			}
			s.current = n;
			let r = c.current;
			jt(n, t, r.pair, r.headroom, r.weight);
		}).catch((t) => {
			e && f("the GPU could not be set up", t);
		}), () => {
			e = !1, s.current?.uniforms.destroy(), s.current?.device.destroy(), s.current = null;
		};
	}, []), t(() => {
		let t = s.current;
		if (t && o.current) try {
			jt(t, o.current, e.pair, e.headroom, e.weight);
		} catch (e) {
			f("drawing failed", e);
		}
	}, [
		e.pair,
		e.headroom,
		e.weight
	]), u ? null : r("canvas", {
		ref: o,
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
var Nt = {
	checking: "Checking the display…",
	"no-hdr-display": "This display isn't in HDR mode. Turn on HDR in the system's display settings.",
	"no-webgpu": "The HDR preview needs WebGPU, which isn't available here."
}, Pt = "(dynamic-range: high)";
function Ft() {
	return {
		hdrDisplay: () => window.matchMedia(Pt).matches,
		adapter: async () => !!await navigator.gpu?.requestAdapter()
	};
}
async function It(e = Ft()) {
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
function Lt() {
	Rt(), Y = n().stores.create((e, t) => ({
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
function Rt() {
	Y?.getState().setPair(null, null);
}
var zt = null;
function Bt() {
	Vt();
	let e = 0, t = () => {
		let t = ++e;
		It().then((n) => {
			t === e && Y?.getState().setSupport(n);
		});
	}, n = window.matchMedia(Pt);
	n.addEventListener("change", t), zt = () => {
		e++, n.removeEventListener("change", t);
	}, t();
}
function Vt() {
	zt?.(), zt = null;
}
//#endregion
//#region src/visualize.ts
var Ht = [
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
], Ut = .01, Z = [
	0,
	0,
	0
];
function Wt(e, t, n, r, i, a, o) {
	Z[0] = I[n], Z[1] = I[r], Z[2] = I[i];
	let s = he(Z), c = Math.log2(Math.max(ye(s, a / 255, o, 1), 1e-6));
	if (c <= Ut) {
		let n = Math.round(Math.round(ve(s) * 255) * .5);
		e[t] = n, e[t + 1] = n, e[t + 2] = n;
		return;
	}
	let l = Ht[Math.min(3, Math.ceil(c) - 1)];
	e[t] = l[0], e[t + 1] = l[1], e[t + 2] = l[2];
}
function Gt(e, t, n) {
	let r = new Uint8ClampedArray(e.width * e.height * 4);
	for (let i = 0; i < e.width * e.height; i++) {
		let a = i * 4;
		Wt(r, a, e.data[a], e.data[a + 1], e.data[a + 2], t.data[a], n), r[a + 3] = 255;
	}
	return r;
}
//#endregion
//#region src/VisualizeLayer.ts
var Kt = 1024;
function qt(e) {
	let { useEffect: t, useRef: i } = n().react, a = i(null);
	return t(() => {
		let t = a.current, n = R(e.pair.sdr, Kt), r = R(e.pair.gain, Kt);
		t && n && r && (t.width = n.width, t.height = n.height, t.getContext("2d")?.putImageData(new ImageData(Gt(n, r, e.headroom), n.width, n.height), 0, 0));
	}, [e.pair, e.headroom]), r("canvas", {
		ref: a,
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
var Jt = "displayHeadroom", Yt = [
	"straighten",
	"crop",
	"transform"
], Xt = ([e], [t]) => e < t ? -1 : +(e > t);
function Zt(e) {
	return JSON.stringify(Yt.map((t) => e[t]), (e, t) => typeof t == "object" && t && !Array.isArray(t) ? Object.fromEntries(Object.entries(t).sort(Xt)) : t);
}
function Qt(e) {
	let t = null;
	if (e) try {
		let n = R(e.sdr, 256), r = R(e.gain, 256);
		n && r && (t = {
			sdr: n,
			gain: r
		});
	} catch (e) {
		console.warn("[hdr-editing] The histogram frame could not be read back.", e);
	}
	X().getState().setPair(e, t);
}
function $t() {
	let { useEffect: e, useRef: t, useState: i } = n().react, a = n().stores.useDevelopStore, o = a((e) => e.photoId), s = a((e) => e.previewParams ?? e.params), c = a((e) => e.previewParamBag ?? e.paramBag), l = a((e) => Object.keys(e.bypassedPanels).length > 0), { rect: u, nonce: d } = n().develop.useDevelopOverlay(), f = X()(), p = t(null), [, m] = i(0), h = W(c), g = !!o && h.on && G(s), _ = f.preview && f.support === "ok", v = g && (f.panels > 0 || _ || f.visualize);
	e(() => n().settings.onChange((e) => {
		e === "displayHeadroom" && m((e) => e + 1);
	}), []), e(() => {
		if (!v) return;
		let e = Dt({
			basis: () => {
				let e = a.getState();
				return {
					headroom: W(e.previewParamBag ?? e.paramBag).headroom,
					geometry: Zt(e.previewParams ?? e.params)
				};
			},
			capture: (e) => {
				let t = a.getState();
				return n().develop.captureFrame(t.previewParams ?? t.params, e ? { paramBag: e } : void 0);
			}
		}, Qt);
		return p.current = e, () => {
			e.stop(), p.current = null, Rt();
		};
	}, [v]), e(() => {
		let e = !1;
		return queueMicrotask(() => {
			e || p.current?.request(d);
		}), () => {
			e = !0;
		};
	}, [
		v,
		o,
		s,
		c,
		d,
		l
	]);
	let y = f.pair;
	if (!g || l || !u || !y || y.nonce !== d || y.geometry !== Zt(s)) return null;
	let { headroom: b } = y, ee = kt(n().settings.get(Jt, 2), b);
	return r("div", { style: {
		position: "absolute",
		inset: 0,
		pointerEvents: "none"
	} }, _ ? r(Mt, {
		key: "preview",
		pair: y,
		headroom: b,
		weight: ee,
		rect: u
	}) : null, f.visualize ? r(qt, {
		key: "visualize",
		pair: y,
		headroom: b,
		rect: u
	}) : null);
}
function en(e, t, n) {
	let r = Math.ceil(F(n)), i = (r - -8) * 4, a = new Uint32Array(i), o = 2 ** -8;
	for (let r = 0; r < e.width * e.height; r++) {
		let s = r * 4, c = he([
			I[e.data[s]],
			I[e.data[s + 1]],
			I[e.data[s + 2]]
		]), l = Math.log2(Math.max(ye(c, t.data[s] / 255, n, 1), o)), u = Math.ceil((l - -8) * 4 - 1e-9) - 1;
		a[Math.min(i - 1, Math.max(0, u))]++;
	}
	return {
		bins: a,
		minStops: -8,
		maxStops: r,
		firstHdrBin: 32
	};
}
//#endregion
//#region src/HistogramView.ts
var Q = 56;
function tn() {
	let { useMemo: e } = n().react, t = X()((e) => e.samples), i = X()((e) => e.pair?.headroom), { tokens: a } = n().ui, o = e(() => t && i !== void 0 ? en(t.sdr, t.gain, i) : null, [t, i]);
	if (!o) return r("div", { style: {
		height: Q,
		fontSize: 11,
		color: a.textMuted,
		display: "flex",
		alignItems: "center",
		justifyContent: "center"
	} }, "No frame");
	let s = Math.max(1, ...o.bins), c = o.bins.length, l = Array.from(o.bins, (e, t) => r("rect", {
		key: t,
		x: t,
		width: .9,
		y: Q - Q * Math.sqrt(e) / Math.sqrt(s),
		height: Q * Math.sqrt(e) / Math.sqrt(s),
		fill: t < o.firstHdrBin ? a.textMuted : a.accent
	}));
	return r("svg", {
		viewBox: `0 0 ${c} ${Q}`,
		preserveAspectRatio: "none",
		style: {
			width: "100%",
			height: Q,
			display: "block"
		}
	}, ...l, r("line", {
		key: "white",
		x1: o.firstHdrBin,
		x2: o.firstHdrBin,
		y1: 0,
		y2: Q,
		stroke: a.textSecondary,
		strokeWidth: .4
	}));
}
//#endregion
//#region src/Panel.ts
var $ = { padding: "6px 8px 8px" };
function nn() {
	let { useEffect: e } = n().react, { Slider: t } = n().components, { Toggle: i, Section: a, Stack: o, tokens: s } = n().ui, c = n().stores.useDevelopStore, l = c((e) => e.paramBag), u = c((e) => e.params), d = c((e) => e.photoId), f = X()(), p = W(l), m = {
		margin: 0,
		fontSize: 10,
		lineHeight: 1.4,
		color: s.textMuted
	};
	e(() => X().getState().panelMounted(), []);
	let h = (e) => c.getState().setDynParams(e), g = (e) => void c.getState().commitEdit(`HDR ${e}`);
	if (!d) return r("div", { style: $ }, r("p", { style: m }, "Open a photo to edit its HDR."));
	if (!G(u)) return r("div", { style: $ }, r("p", { style: m }, "HDR needs the current processing. Use Update processing in the Develop status bar."));
	let _ = (e, n, i, a, o) => r(t, {
		key: n,
		label: e,
		value: p[n],
		min: i,
		max: a,
		step: o,
		defaultValue: Be[n],
		onChange: (e) => h({ [H[n]]: e }),
		onCommit: () => g(e.toLowerCase())
	}), v = f.support === "ok" ? null : Nt[f.support];
	return r(o, {
		gap: 8,
		style: $
	}, r(i, {
		key: "on",
		checked: p.on,
		label: "HDR",
		onChange: (e) => {
			h(Ve({ on: e })), g(e ? "on" : "off");
		}
	}), p.on ? r(tn, { key: "histogram" }) : null, p.on ? r(a, {
		key: "rendition",
		title: "Rendition"
	}, r(o, { gap: 1 }, _("Headroom", "headroom", .5, 4, .1), _("Start", "start", -3, 0, .05), _("Roll-off", "rolloff", .5, 4, .1), _("Highlight protection", "protection", 0, 100, 1))) : null, p.on ? r(a, {
		key: "view",
		title: "View"
	}, r(o, { gap: 4 }, r(i, {
		checked: f.preview && f.support === "ok",
		label: "HDR preview",
		onChange: (e) => X().getState().setPreview(e && f.support === "ok")
	}), v ? r("p", { style: m }, v) : null, r(i, {
		checked: f.visualize,
		label: "Visualize HDR",
		onChange: (e) => X().getState().setVisualize(e)
	}))) : null);
}
//#endregion
//#region src/glsl.ts
var rn = String(P), an = `float hdRho(float x, float startEv, float rolloffEv) {
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
  float corrected = log2((s * exp2(g) + ${rn}) / (s + ${rn}));
  return clamp(corrected / headroomEv, 0.0, 1.0);
}`, on = "if (mode == 1) {\n  float hdS = luma(srgbToLinear(clamp(c, 0.0, 1.0)));\n  float hdH = hdHeadroom(headroom);\n  float hdG = on > 0.5 ? hdH * hdRho(slSceneLuma, start, rolloff) * hdGate(hdS, protection) : 0.0;\n  c = vec3(hdEncode(hdS, hdG, hdH));\n}";
//#endregion
//#region src/stage.ts
function sn() {
	return {
		id: Pe,
		name: "HDR",
		phase: "output-encode",
		priority: 1e3,
		space: { encoding: "perceptual" },
		glsl: on,
		helpers: an,
		uniforms: V.map((e) => ({
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
function cn() {
	let e = n().stores.useDevelopStore.getState();
	e.setDynParams(He()), e.commitEdit("HDR reset");
}
function ln(e) {
	t(e), Lt(), Bt(), e.registerProcessingStage(sn()), e.registerPanel({
		id: Fe,
		title: "HDR",
		component: nn,
		defaultDock: {
			module: "develop",
			direction: "right",
			order: 5.5,
			width: 280
		},
		modules: ["develop"],
		onReset: cn
	}), e.registerSlot({
		id: Ie,
		slot: "develop-canvas-overlay",
		component: $t,
		order: 50
	}), e.registerSettings({
		title: "HDR Editing",
		keywords: [
			"hdr",
			"headroom",
			"display"
		],
		fields: [{
			key: Jt,
			label: "Display headroom (stops)",
			hint: "How far above SDR white your display can go. The HDR preview scales its highlights to fit; no system API reports it.",
			type: "number",
			default: 2,
			min: .5,
			max: 4,
			step: .1
		}]
	}), e.registerExportProcessor({
		id: Le,
		label: "HDR",
		settings: pt,
		process: (e, t, n, r) => Tt(e, t, n, r, Et())
	});
}
function un() {
	c.stop(), dt.clear(), Vt();
	try {
		Rt();
		let e = n();
		e.unregisterProcessingStage(sn().id), e.unregisterSlot(Ie);
	} catch {}
}
//#endregion
export { ln as activate, un as deactivate };

//# sourceMappingURL=index.js.map