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
function ee(e) {
	return `${location.origin}/__plugins__/${s}/${e}?v=1.0.0`;
}
//#endregion
//#region src/avif-worker-client.ts
function te() {
	return new Worker(ee("dist/avif-worker.js"), { type: "module" });
}
var ne = (...e) => e.map((e) => e.data.buffer).filter((e) => e instanceof ArrayBuffer);
function re(e) {
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
				}, ne(e, i));
			} catch (e) {
				r.delete(u), l(e);
			}
		}),
		stop: () => i()
	};
}
var ie = re(te), ae = (e, t) => String.fromCharCode(e[t], e[t + 1], e[t + 2], e[t + 3]);
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
			type: ae(e, a + 4),
			content: a + o,
			end: a + t
		}), a += t;
	}
	return i;
}
var oe = 11;
function se(e) {
	let t = S(e, 0, e.length).find((e) => e.type === "meta");
	if (!t) return null;
	let n = S(e, t.content + 4, t.end).find((e) => e.type === "iprp"), r = n && S(e, n.content, n.end).find((e) => e.type === "ipco"), i = r && S(e, r.content, r.end).find((t) => t.type === "colr" && t.end - t.content >= oe && ae(e, t.content) === "nclx");
	return i ? i.content + 4 : null;
}
function ce(e, t = 9, n = 16) {
	let r = se(e);
	if (r === null) return !1;
	let i = new DataView(e.buffer, e.byteOffset, e.byteLength);
	return i.setUint16(r, t), i.setUint16(r + 2, n), !0;
}
//#endregion
//#region src/frame.ts
var C = Float64Array.from({ length: 256 }, (e, t) => r(t / 255)), w = null;
function T(e, t) {
	let { width: n, height: r } = e;
	if (n < 2 || r < 2) return null;
	let i = Math.min(1, t / Math.max(n, r)), a = Math.max(1, Math.round(n * i)), o = Math.max(1, Math.round(r * i));
	w ||= new OffscreenCanvas(a, o), w.width !== a && (w.width = a), w.height !== o && (w.height = o);
	let s = w.getContext("2d", { willReadFrequently: !0 });
	return s ? (s.globalCompositeOperation = "copy", s.imageSmoothingQuality = "high", s.drawImage(e, 0, 0, a, o), {
		data: s.getImageData(0, 0, a, o).data,
		width: a,
		height: o
	}) : null;
}
//#endregion
//#region src/jpeg.ts
function E(e) {
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
var le = (e) => e >= 192 && e <= 207 && e !== 196 && e !== 200 && e !== 204;
function ue(e) {
	try {
		let { segments: t } = E(e), n = t.find((e) => le(e.marker));
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
function de(e, t) {
	return e.subarray(t.start + 4, t.end);
}
function D(e, t) {
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
function O(e) {
	let t = new Uint8Array(e.reduce((e, t) => e + t.length, 0)), n = 0;
	for (let r of e) t.set(r, n), n += r.length;
	return t;
}
var k = (e) => new TextEncoder().encode(e);
function fe(e, t) {
	if (e.length < t.length) return !1;
	for (let n = 0; n < t.length; n++) if (e[n] !== t[n]) return !1;
	return !0;
}
//#endregion
//#region src/jpeg-encode.ts
var pe = Int32Array.from([
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
]), me = [
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
], he = [
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
], A = [
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
], j = [
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
], M = [
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
], N = /* @__PURE__ */ new Float64Array(64);
for (let e = 0; e < 8; e++) for (let t = 0; t < 8; t++) N[e * 8 + t] = (e === 0 ? Math.SQRT1_2 : 1) * Math.cos((2 * t + 1) * e * Math.PI / 16) / 2;
function ge(e) {
	let t = Math.min(100, Math.max(1, Math.round(e))), n = t < 50 ? Math.floor(5e3 / t) : 200 - 2 * t;
	return Uint8Array.from(me, (e) => Math.min(255, Math.max(1, Math.floor((e * n + 50) / 100))));
}
function P(e, t) {
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
var _e = class {
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
}, F = (e) => e === 0 ? 0 : 32 - Math.clz32(Math.abs(e)), I = (e, t) => e < 0 ? e + (1 << t) - 1 : e;
function ve(e, t, n) {
	for (let n = 0; n < 8; n++) for (let r = 0; r < 8; r++) {
		let i = 0;
		for (let t = 0; t < 8; t++) i += e[n * 8 + t] * N[r * 8 + t];
		t[n * 8 + r] = i;
	}
	for (let e = 0; e < 8; e++) for (let r = 0; r < 8; r++) {
		let i = 0;
		for (let n = 0; n < 8; n++) i += t[n * 8 + r] * N[e * 8 + n];
		n[e * 8 + r] = i;
	}
}
function ye(e, t, n, r = 90) {
	let i = ge(r), a = P(he, A), o = P(j, M), s = new _e(), c = /* @__PURE__ */ new Float64Array(64), l = /* @__PURE__ */ new Float64Array(64), u = /* @__PURE__ */ new Float64Array(64), d = /* @__PURE__ */ new Int32Array(64), f = 0;
	for (let r = 0; r < n; r += 8) for (let p = 0; p < t; p += 8) {
		for (let i = 0; i < 8; i++) {
			let a = Math.min(r + i, n - 1) * t;
			for (let n = 0; n < 8; n++) c[i * 8 + n] = e[a + Math.min(p + n, t - 1)] - 128;
		}
		ve(c, l, u);
		for (let e = 0; e < 64; e++) {
			let t = pe[e], n = Math.round(u[t] / i[t]);
			d[e] = e === 0 ? n : Math.max(-1023, Math.min(1023, n));
		}
		let m = d[0] - f;
		f = d[0];
		let h = F(m);
		s.write(a.code[h], a.size[h]), h > 0 && s.write(I(m, h), h);
		let g = 0;
		for (let e = 1; e < 64; e++) {
			let t = d[e];
			if (t === 0) {
				g++;
				continue;
			}
			for (; g > 15;) s.write(o.code[240], o.size[240]), g -= 16;
			let n = F(t), r = g << 4 | n;
			s.write(o.code[r], o.size[r]), s.write(I(t, n), n), g = 0;
		}
		g > 0 && s.write(o.code[0], o.size[0]);
	}
	let p = /* @__PURE__ */ new Uint8Array(65);
	for (let e = 0; e < 64; e++) p[1 + e] = i[pe[e]];
	return O([
		Uint8Array.of(255, 216),
		D(224, Uint8Array.of(74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0)),
		D(219, p),
		D(192, Uint8Array.of(8, n >> 8, n & 255, t >> 8, t & 255, 1, 1, 17, 0)),
		D(196, Uint8Array.from([
			0,
			...he,
			...A,
			16,
			...j,
			...M
		])),
		D(218, Uint8Array.of(1, 1, 0, 0, 63, 0)),
		s.bytes(),
		Uint8Array.of(255, 217)
	]);
}
//#endregion
//#region src/pq.ts
function be(e, t) {
	if (t.width !== e.width || t.height !== e.height) throw Error(`[hdr-editing] the gain map is ${t.width}x${t.height}, the image ${e.width}x${e.height}`);
}
//#endregion
//#region src/runtime.ts
var L = null;
function xe(e) {
	L = e;
}
function R() {
	if (!L) throw Error("[hdr-editing] api() called before activate()");
	return L;
}
function z(e, t, ...n) {
	return R().react.createElement(e, t, ...n);
}
//#endregion
//#region src/ultrahdr.ts
var B = k("http://ns.adobe.com/xap/1.0/\0"), V = k("urn:iso:std:iso:ts:21496:-1\0"), Se = k("MPF\0"), Ce = k("Exif\0\0"), we = k("ICC_PROFILE\0"), Te = 224, H = 225, U = 226, Ee = 237, De = 90, W = (e) => String(Number(e.toPrecision(6)));
function Oe(e) {
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
function ke(t) {
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
		`      hdrgm:GainMapMax="${W(t)}"`,
		"      hdrgm:Gamma=\"1\"",
		`      hdrgm:OffsetSDR="${W(e)}"`,
		`      hdrgm:OffsetHDR="${W(e)}"`,
		"      hdrgm:HDRCapacityMin=\"0\"",
		`      hdrgm:HDRCapacityMax="${W(t)}"`,
		"      hdrgm:BaseRenditionIsHDR=\"False\"/>",
		"  </rdf:RDF>",
		"</x:xmpmeta>",
		""
	].join("\n");
}
var Ae = (e, t) => t === 0 ? e : Ae(t, e % t);
function je(e) {
	let t = Math.round(e * 10), n = Ae(t, 10);
	return [t / n, 10 / n];
}
function Me() {
	return D(U, new Uint8Array([
		...V,
		0,
		0,
		0,
		0
	]));
}
function Ne(e) {
	let t = /* @__PURE__ */ new Uint8Array(61), n = new DataView(t.buffer), [r, i] = je(e);
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
function Pe(e, t, n) {
	let r = /* @__PURE__ */ new Uint8Array(86), i = new DataView(r.buffer);
	return r.set(Se, 0), r.set([
		77,
		77,
		0,
		42
	], 4), i.setUint32(8, 8), i.setUint16(12, 3), i.setUint16(14, 45056), i.setUint16(16, 7), i.setUint32(18, 4), r.set(k("0100"), 22), i.setUint16(26, 45057), i.setUint16(28, 4), i.setUint32(30, 1), i.setUint32(34, 2), i.setUint16(38, 45058), i.setUint16(40, 7), i.setUint32(42, 32), i.setUint32(46, 50), i.setUint32(50, 0), i.setUint32(54, 196608), i.setUint32(58, e), i.setUint32(62, 0), i.setUint32(70, 0), i.setUint32(74, t), i.setUint32(78, n), D(U, r);
}
function Fe(e, t) {
	let n = de(e, t);
	return t.marker === Te ? "jfif" : t.marker === H && fe(n, Ce) ? "exif" : t.marker === U && fe(n, we) ? "icc" : t.marker === Ee ? "keep" : t.marker >= 224 && t.marker <= 239 ? "drop" : "table";
}
function Ie(e, t) {
	let n = t + 2 + (e[t + 2] << 8 | e[t + 3]);
	for (let t = n; t + 1 < e.length; t++) if (e[t] === 255 && e[t + 1] === 217) return t + 2;
	throw Error("[hdr-editing] JPEG has no end of image");
}
function Le(e, t, n) {
	if (!Number.isFinite(n)) throw Error(`[hdr-editing] headroom ${n} is not a number`);
	if (t.length < 2 || t[0] !== 255 || t[1] !== 216) throw Error("[hdr-editing] the gain map is not a JPEG");
	let r = a(n), i = O([
		Uint8Array.of(255, 216),
		D(H, new Uint8Array([...B, ...k(ke(r))])),
		D(U, new Uint8Array([...V, ...Ne(r)])),
		t.subarray(2)
	]), { segments: o, scan: s } = E(e), c = (t) => o.filter((n) => Fe(e, n) === t).map((t) => e.subarray(t.start, t.end)), l = O([
		Uint8Array.of(255, 216),
		...c("jfif"),
		...c("exif"),
		D(H, new Uint8Array([...B, ...k(Oe(i.length))])),
		...c("icc"),
		Me(),
		...c("keep"),
		...c("table")
	]), u = e.subarray(s, Ie(e, s)), d = l.length + De + u.length;
	return O([
		l,
		Pe(d, i.length, d - (l.length + 8)),
		u,
		i
	]);
}
var Re = 80, ze = [{
	key: "output",
	label: "HDR output",
	hint: "For photos with HDR on. Ultra HDR needs the JPEG format. HDR AVIF replaces a JPEG, PNG or WebP file with one built from an sRGB render, without metadata or output sharpening.",
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
	default: Re,
	min: 1,
	max: 100,
	step: 1
}], Be = (e, t) => new Blob([new Uint8Array(e)], { type: t });
function Ve(e) {
	let t = new Uint8Array(e.width * e.height);
	for (let n = 0; n < t.length; n++) t[n] = e.data[n * 4];
	return t;
}
function He(e, t) {
	let n = typeof e == "number" ? Math.trunc(e) : NaN;
	return Number.isNaN(n) ? t - 1 : Math.min(Math.max(n, 0), t - 1);
}
function Ue(e) {
	let t = typeof e == "string" && e.trim() !== "" ? Number(e) : e;
	return typeof t != "number" || !Number.isFinite(t) ? Re : Math.min(100, Math.max(1, Math.round(t)));
}
async function G(e, t, n, r) {
	let i = await r.render(e, t, n), a = i && await r.decode(i);
	if (!a) throw Error(`the ${n ? "gain map" : "SDR image"} didn't render`);
	return a;
}
function We(e, t) {
	return Math.abs(e.width * t.height - e.height * t.width) <= t.width + t.height;
}
async function Ge(e, t, n, r, i) {
	if (e.type !== "image/jpeg") return i.warn(`[hdr-editing] Ultra HDR needs the JPEG export format; ${t.id} was exported without HDR.`), e;
	let a = new Uint8Array(await e.arrayBuffer()), o = ue(a);
	if (!o) throw Error("the exported JPEG has no size");
	let s = await G(t, r, !0, i);
	if (!We(s, o)) throw Error(`the gain map came out ${s.width}×${s.height}, not the shape of the ${o.width}×${o.height} image`);
	return Be(Le(a, ye(Ve(s), s.width, s.height, 90), n.headroom), "image/jpeg");
}
async function Ke(e, t, n, r, i, a) {
	if (e.type !== "image/jpeg" && e.type !== "image/png" && e.type !== "image/webp") return a.warn(`[hdr-editing] HDR AVIF needs the JPEG, PNG or WebP export format; ${t.id} was exported without HDR.`), e;
	let o = await G(t, i, !1, a), s = await G(t, i, !0, a);
	be(o, s);
	let c = await a.encodeAvif(o, s, n.headroom, r);
	if (!ce(c)) throw Error("the AVIF has no colour box to mark as PQ");
	return Be(c, "image/avif");
}
async function qe(e, t, n, r, i) {
	let a = n.output;
	if (a !== "ultrahdr" && a !== "avif") return e;
	try {
		let o = await i.edit(t.id);
		if (!o || !x(o.params)) return e;
		let s = _(o.bag);
		return s.on ? a === "ultrahdr" ? await Ge(e, t, s, r.longEdge, i) : await Ke(e, t, s, Ue(n.avifQuality), r.longEdge, i) : e;
	} catch (n) {
		return i.warn(`[hdr-editing] HDR export of ${t.id} failed, exported without HDR: ${n instanceof Error ? n.message : String(n)}`), e;
	}
}
function Je() {
	let e = R();
	return {
		edit: async (t) => {
			let n = await e.catalog.getEditState(t);
			if (!n || n.stack.length === 0) return null;
			let r = n.stack[He(n.currentIndex, n.stack.length)];
			return {
				bag: r.paramBag ?? {},
				params: r.params
			};
		},
		render: async (t, n, r) => {
			let [i] = await e.export.renderPhotos([t], {
				format: "image/png",
				longEdge: n,
				colorSpace: "srgb",
				sharpenAmount: 0,
				includeMetadata: !1
			}, void 0, r ? { paramBag: { ...m } } : void 0);
			return i?.blob ?? null;
		},
		decode: async (e) => {
			let t = await createImageBitmap(e, {
				colorSpaceConversion: "none",
				premultiplyAlpha: "none"
			});
			try {
				return T(t, Infinity);
			} finally {
				t.close();
			}
		},
		encodeAvif: (e, t, n, r) => ie.encode(e, t, n, r),
		warn: (e) => console.warn(e)
	};
}
//#endregion
//#region src/frames.ts
function Ye(e, t) {
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
var Xe = "\nstruct Params { headroom: f32, weight: f32, offset: f32, pad: f32 };\n@group(0) @binding(0) var sdrTex: texture_2d<f32>;\n@group(0) @binding(1) var gainTex: texture_2d<f32>;\n@group(0) @binding(2) var<uniform> params: Params;\n\nstruct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };\n\n@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {\n  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));\n  var out: VOut;\n  out.pos = vec4f(p[i], 0.0, 1.0);\n  out.uv = vec2f((p[i].x + 1.0) * 0.5, (1.0 - p[i].y) * 0.5);\n  return out;\n}\n\nfn decode(c: vec3f) -> vec3f {\n  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c < vec3f(0.04045));\n}\n\nfn encodeExtended(v: vec3f) -> vec3f {\n  let a = abs(v);\n  let e = select(1.055 * pow(a, vec3f(1.0 / 2.4)) - 0.055, a * 12.92, a < vec3f(0.0031308));\n  return sign(v) * e;\n}\n\nfn texel(t: texture_2d<f32>, uv: vec2f) -> vec4f {\n  let size = vec2f(textureDimensions(t));\n  return textureLoad(t, vec2i(clamp(uv * size, vec2f(0.0), size - 1.0)), 0);\n}\n\n@fragment fn fs(in: VOut) -> @location(0) vec4f {\n  let sdr = decode(texel(sdrTex, in.uv).rgb);\n  let r = texel(gainTex, in.uv).r;\n  let hdr = (sdr + params.offset) * exp2(r * params.headroom * params.weight) - params.offset;\n  return vec4f(encodeExtended(hdr), 1.0);\n}\n";
function Ze(e, t) {
	return Math.min(1, Math.max(0, e / a(t)));
}
//#endregion
//#region src/PreviewLayer.ts
async function Qe(e, t) {
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
		let o = r.createShaderModule({ code: Xe }), s = r.createRenderPipeline({
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
function $e(t, n, r, i, o) {
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
function et(e) {
	let { useEffect: t, useRef: n, useState: r } = R().react, i = n(null), a = n(null), o = n(e), s = n(!1), [c, l] = r(!1), u = (e, t) => {
		s.current || (s.current = !0, console.warn(`[hdr-editing] The HDR preview was hidden: ${e}.`, t)), l(!0);
	};
	return t(() => {
		o.current = e;
	}), t(() => {
		let e = !0, t = i.current;
		if (t) return Qe(t, (t, n) => {
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
			$e(n, t, r.pair, r.headroom, r.weight);
		}).catch((t) => {
			e && u("the GPU could not be set up", t);
		}), () => {
			e = !1, a.current?.uniforms.destroy(), a.current?.device.destroy(), a.current = null;
		};
	}, []), t(() => {
		let t = a.current;
		if (t && i.current) try {
			$e(t, i.current, e.pair, e.headroom, e.weight);
		} catch (e) {
			u("drawing failed", e);
		}
	}, [
		e.pair,
		e.headroom,
		e.weight
	]), c ? null : z("canvas", {
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
var tt = {
	checking: "Checking the display…",
	"no-hdr-display": "This display isn't in HDR mode. Turn on HDR in the system's display settings.",
	"no-webgpu": "The HDR preview needs WebGPU, which isn't available here."
}, nt = "(dynamic-range: high)";
function rt() {
	return {
		hdrDisplay: () => window.matchMedia(nt).matches,
		adapter: async () => !!await navigator.gpu?.requestAdapter()
	};
}
async function it(e = rt()) {
	if (!e.hdrDisplay()) return "no-hdr-display";
	try {
		return await e.adapter() ? "ok" : "no-webgpu";
	} catch {
		return "no-webgpu";
	}
}
//#endregion
//#region src/store.ts
var K = null;
function at() {
	J(), K = R().stores.create((e, t) => ({
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
function q() {
	if (!K) throw Error("[hdr-editing] store() called before activate()");
	return K;
}
function J() {
	K?.getState().setPair(null, null);
}
var Y = null;
function ot() {
	st();
	let e = 0, t = () => {
		let t = ++e;
		it().then((n) => {
			t === e && K?.getState().setSupport(n);
		});
	}, n = window.matchMedia(nt);
	n.addEventListener("change", t), Y = () => {
		e++, n.removeEventListener("change", t);
	}, t();
}
function st() {
	Y?.(), Y = null;
}
//#endregion
//#region src/visualize.ts
var ct = [
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
], lt = .01, X = [
	0,
	0,
	0
];
function ut(e, n, r, a, s, c, l) {
	X[0] = C[r], X[1] = C[a], X[2] = C[s];
	let u = t(X), d = Math.log2(Math.max(o(u, c / 255, l, 1), 1e-6));
	if (d <= lt) {
		let t = Math.round(Math.round(i(u) * 255) * .5);
		e[n] = t, e[n + 1] = t, e[n + 2] = t;
		return;
	}
	let f = ct[Math.min(3, Math.ceil(d) - 1)];
	e[n] = f[0], e[n + 1] = f[1], e[n + 2] = f[2];
}
function dt(e, t, n) {
	let r = new Uint8ClampedArray(e.width * e.height * 4);
	for (let i = 0; i < e.width * e.height; i++) {
		let a = i * 4;
		ut(r, a, e.data[a], e.data[a + 1], e.data[a + 2], t.data[a], n), r[a + 3] = 255;
	}
	return r;
}
//#endregion
//#region src/VisualizeLayer.ts
var ft = 1024;
function pt(e) {
	let { useEffect: t, useRef: n } = R().react, r = n(null);
	return t(() => {
		let t = r.current, n = T(e.pair.sdr, ft), i = T(e.pair.gain, ft);
		t && n && i && (t.width = n.width, t.height = n.height, t.getContext("2d")?.putImageData(new ImageData(dt(n, i, e.headroom), n.width, n.height), 0, 0));
	}, [e.pair, e.headroom]), z("canvas", {
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
var Z = "displayHeadroom", mt = [
	"straighten",
	"crop",
	"transform"
], ht = ([e], [t]) => e < t ? -1 : +(e > t);
function gt(e) {
	return JSON.stringify(mt.map((t) => e[t]), (e, t) => typeof t == "object" && t && !Array.isArray(t) ? Object.fromEntries(Object.entries(t).sort(ht)) : t);
}
function _t(e) {
	let t = null;
	if (e) try {
		let n = T(e.sdr, 256), r = T(e.gain, 256);
		n && r && (t = {
			sdr: n,
			gain: r
		});
	} catch (e) {
		console.warn("[hdr-editing] The histogram frame could not be read back.", e);
	}
	q().getState().setPair(e, t);
}
function vt() {
	let { useEffect: e, useRef: t, useState: n } = R().react, r = R().stores.useDevelopStore, i = r((e) => e.photoId), a = r((e) => e.previewParams ?? e.params), o = r((e) => e.previewParamBag ?? e.paramBag), s = r((e) => e.activeTool !== "none" || e.cropping), c = r((e) => Object.keys(e.bypassedPanels).length > 0), { rect: l, nonce: u } = R().develop.useDevelopOverlay(), d = q()(), f = t(null), [, p] = n(0), m = _(o), h = !!i && m.on && x(a), g = d.preview && d.support === "ok", v = h && (d.panels > 0 || g || d.visualize);
	e(() => R().settings.onChange((e) => {
		e === "displayHeadroom" && p((e) => e + 1);
	}), []), e(() => {
		if (!v) return;
		let e = Ye({
			basis: () => {
				let e = r.getState();
				return {
					headroom: _(e.previewParamBag ?? e.paramBag).headroom,
					geometry: gt(e.previewParams ?? e.params)
				};
			},
			capture: (e) => {
				let t = r.getState();
				return R().develop.captureFrame(t.previewParams ?? t.params, e ? { paramBag: e } : void 0);
			}
		}, _t);
		return f.current = e, () => {
			e.stop(), f.current = null, J();
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
	if (!h || s || c || !l || !y || y.nonce !== u || y.geometry !== gt(a)) return null;
	let { headroom: b } = y, ee = Ze(R().settings.get(Z, 2), b);
	return z("div", { style: {
		position: "absolute",
		inset: 0,
		pointerEvents: "none"
	} }, g ? z(et, {
		key: "preview",
		pair: y,
		headroom: b,
		weight: ee,
		rect: l
	}) : null, d.visualize ? z(pt, {
		key: "visualize",
		pair: y,
		headroom: b,
		rect: l
	}) : null);
}
function yt(e, n, r) {
	let i = Math.ceil(a(r)), s = (i - -8) * 4, c = new Uint32Array(s), l = 2 ** -8;
	for (let i = 0; i < e.width * e.height; i++) {
		let a = i * 4, u = t([
			C[e.data[a]],
			C[e.data[a + 1]],
			C[e.data[a + 2]]
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
function bt() {
	let { useMemo: e } = R().react, t = q()((e) => e.samples), n = q()((e) => e.pair?.headroom), { tokens: r } = R().ui, i = e(() => t && n !== void 0 ? yt(t.sdr, t.gain, n) : null, [t, n]);
	if (!i) return z("div", { style: {
		height: Q,
		fontSize: 11,
		color: r.textMuted,
		display: "flex",
		alignItems: "center",
		justifyContent: "center"
	} }, "No frame");
	let a = Math.max(1, ...i.bins), o = i.bins.length, s = Array.from(i.bins, (e, t) => z("rect", {
		key: t,
		x: t,
		width: .9,
		y: Q - Q * Math.sqrt(e) / Math.sqrt(a),
		height: Q * Math.sqrt(e) / Math.sqrt(a),
		fill: t < i.firstHdrBin ? r.textMuted : r.accent
	}));
	return z("svg", {
		viewBox: `0 0 ${o} ${Q}`,
		preserveAspectRatio: "none",
		style: {
			width: "100%",
			height: Q,
			display: "block"
		}
	}, ...s, z("line", {
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
function xt() {
	let { useEffect: e } = R().react, { Slider: t } = R().components, { Toggle: n, Section: r, Stack: i, tokens: a } = R().ui, o = R().stores.useDevelopStore, s = o((e) => e.paramBag), c = o((e) => e.params), l = o((e) => e.photoId), u = q()(), d = _(s), f = {
		margin: 0,
		fontSize: 10,
		lineHeight: 1.4,
		color: a.textMuted
	};
	e(() => q().getState().panelMounted(), []);
	let m = (e) => o.getState().setDynParams(e), h = (e) => void o.getState().commitEdit(`HDR ${e}`);
	if (!l) return z("div", { style: $ }, z("p", { style: f }, "Open a photo to edit its HDR."));
	if (!x(c)) return z("div", { style: $ }, z("p", { style: f }, "HDR needs the current processing. Use Update processing in the Develop status bar."));
	let g = (e, n, r, i, a) => z(t, {
		key: n,
		label: e,
		value: d[n],
		min: r,
		max: i,
		step: a,
		defaultValue: v[n],
		onChange: (e) => m({ [p[n]]: e }),
		onCommit: () => h(e.toLowerCase())
	}), b = u.support === "ok" ? null : tt[u.support];
	return z(i, {
		gap: 8,
		style: $
	}, z(n, {
		key: "on",
		checked: d.on,
		label: "HDR",
		onChange: (e) => {
			m(y({ on: e })), h(e ? "on" : "off");
		}
	}), d.on ? z(bt, { key: "histogram" }) : null, d.on ? z(r, {
		key: "rendition",
		title: "Rendition"
	}, z(i, { gap: 1 }, g("Headroom", "headroom", .5, 4, .1), g("Start", "start", -3, 0, .05), g("Roll-off", "rolloff", .5, 4, .1), g("Highlight protection", "protection", 0, 100, 1))) : null, d.on ? z(r, {
		key: "view",
		title: "View"
	}, z(i, { gap: 4 }, z(n, {
		checked: u.preview && u.support === "ok",
		label: "HDR preview",
		onChange: (e) => q().getState().setPreview(e && u.support === "ok")
	}), b ? z("p", { style: f }, b) : null, z(n, {
		checked: u.visualize,
		label: "Visualize HDR",
		onChange: (e) => q().getState().setVisualize(e)
	}))) : null);
}
//#endregion
//#region src/glsl.ts
var St = String(e), Ct = `float hdRho(float x, float startEv, float rolloffEv) {
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
  float corrected = log2((s * exp2(g) + ${St}) / (s + ${St}));
  return clamp(corrected / headroomEv, 0.0, 1.0);
}`, wt = "if (mode == 1) {\n  float hdS = luma(srgbToLinear(clamp(c, 0.0, 1.0)));\n  float hdH = hdHeadroom(headroom);\n  float hdG = on > 0.5 ? hdH * hdRho(slSceneLuma, start, rolloff) * hdGate(hdS, protection) : 0.0;\n  c = vec3(hdEncode(hdS, hdG, hdH));\n}";
//#endregion
//#region src/stage.ts
function Tt() {
	return {
		id: c,
		name: "HDR",
		phase: "output-encode",
		priority: 1e3,
		space: { encoding: "perceptual" },
		glsl: wt,
		helpers: Ct,
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
function Et() {
	let e = R().stores.useDevelopStore.getState();
	e.setDynParams(b()), e.commitEdit("HDR reset");
}
function Dt(e) {
	xe(e), at(), ot(), e.registerProcessingStage(Tt()), e.registerPanel({
		id: l,
		title: "HDR",
		component: xt,
		defaultDock: {
			module: "develop",
			direction: "right",
			order: 5.5,
			width: 280
		},
		onReset: Et
	}), e.registerSlot({
		id: u,
		slot: "develop-canvas-overlay",
		component: vt,
		order: 50
	}), e.registerSettings({
		title: "HDR Editing",
		keywords: [
			"hdr",
			"headroom",
			"display"
		],
		fields: [{
			key: Z,
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
		settings: ze,
		process: (e, t, n, r) => qe(e, t, n, r, Je())
	});
}
function Ot() {
	ie.stop(), st();
	try {
		J();
		let e = R();
		e.unregisterProcessingStage(Tt().id), e.unregisterSlot(u);
	} catch {}
}
//#endregion
export { Dt as activate, Ot as deactivate };

//# sourceMappingURL=index.js.map